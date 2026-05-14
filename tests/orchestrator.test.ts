import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runPlan, type OrchestratorDeps } from '../src/orchestrator.js';
import { saveState, createInitialState } from '../src/state/state.js';
import { parseMarkdownString } from '../src/parser/markdown.js';
import { validatePlan } from '../src/validator/plan-validator.js';
import type { AutopilotConfig, AutopilotState, Task } from '../src/types.js';

let tempDir: string;

// Mock executeTask to avoid spawning real claude processes
vi.mock('../src/executor/executor.js', () => ({
  executeTask: vi.fn(async () => ({
    stdout: 'done',
    stderr: '',
    exitCode: 0,
    rateLimited: false,
  })),
  buildPrompt: vi.fn(() => 'mock prompt'),
  isRateLimited: vi.fn(() => false),
}));

function makeConfig(): AutopilotConfig {
  return {
    defaultMode: 'auto',
    codeReview: { strategy: 'none', maxRevisions: 3 },
    merge: { strategy: 'auto', method: 'squash' },
    git: { baseBranch: 'dev', branchPrefix: 'autopilot/' },
    parallel: { maxConcurrent: 3, useContextSync: false },
    validation: { typecheck: false, test: false, build: false, maxRetries: 3 },
    rateLimit: { healthCheckInterval: 0.01, autoResume: true },
    system: { preventSleep: false },
    source: { type: 'markdown', githubLabel: 'autopilot' },
  };
}

function makeDeps(): OrchestratorDeps {
  return {
    publisher: {
      git: async () => ({ stdout: '', exitCode: 0 }),
      gh: async () => ({ stdout: 'https://github.com/org/repo/pull/1', exitCode: 0 }),
    },
    commandRunner: async () => ({ output: 'src/file.ts', exitCode: 0 }),
    ghRunner: async () => ({ stdout: 'APPROVED', exitCode: 0 }),
    healthCheck: async () => true,
  };
}

describe('runPlan — integration', () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'autopilot-orch-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('parse → validate → queue → execute → validate → publish 파이프라인', async () => {
    const md = `
- [ ] [id: task-a] [auto] A 구현 — 상세 A
- [ ] [id: task-b] [auto] (depends: task-a) B 구현 — 상세 B
    `;

    const tasks = parseMarkdownString(md);
    const report = validatePlan(tasks);
    expect(report.failCount).toBe(0);

    const state = createInitialState('plan.md', tasks.map((t) => t.id));
    await saveState(state, tempDir);

    const results = await runPlan(tasks, makeConfig(), state, tempDir, '/tmp', makeDeps());

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.outcome === 'completed')).toBe(true);
  });

  it('독립 태스크는 같은 그룹에서 병렬 실행된다', async () => {
    const md = `
- [ ] [id: a] [auto] A — detail
- [ ] [id: b] [auto] B — detail
- [ ] [id: c] [auto] C — detail
    `;

    const tasks = parseMarkdownString(md);
    const state = createInitialState('plan.md', tasks.map((t) => t.id));
    await saveState(state, tempDir);

    const results = await runPlan(tasks, makeConfig(), state, tempDir, '/tmp', makeDeps());

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.outcome === 'completed')).toBe(true);
  });

  it('실행 실패 시 failed 결과를 반환한다', async () => {
    const { executeTask } = await import('../src/executor/executor.js');
    vi.mocked(executeTask).mockResolvedValueOnce({
      stdout: '',
      stderr: 'error',
      exitCode: 1,
      rateLimited: false,
    }).mockResolvedValueOnce({
      stdout: '',
      stderr: 'error',
      exitCode: 1,
      rateLimited: false,
    }).mockResolvedValueOnce({
      stdout: '',
      stderr: 'error',
      exitCode: 1,
      rateLimited: false,
    });

    const md = '- [ ] [id: fail-task] [auto] 실패 태스크 — detail';
    const tasks = parseMarkdownString(md);
    const state = createInitialState('plan.md', ['fail-task']);
    await saveState(state, tempDir);

    const results = await runPlan(tasks, makeConfig(), state, tempDir, '/tmp', makeDeps());

    expect(results).toHaveLength(1);
    expect(results[0].outcome).toBe('failed');
  });
});
