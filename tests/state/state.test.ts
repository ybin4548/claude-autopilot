import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadState,
  saveState,
  updateTaskState,
  createInitialState,
} from '../../src/state/state.js';
import type { AutopilotState } from '../../src/types.js';

let tempDir: string;

function makeState(overrides: Partial<AutopilotState> = {}): AutopilotState {
  return {
    planSource: 'plan.md',
    startedAt: '2026-05-15T10:00:00Z',
    tasks: [
      { id: 'task-a', status: 'pending' },
      { id: 'task-b', status: 'pending' },
    ],
    rateLimited: false,
    lastHealthCheck: null,
    ...overrides,
  };
}

describe('state', () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'autopilot-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('상태가 없으면 null을 반환한다', async () => {
    const state = await loadState(tempDir);
    expect(state).toBeNull();
  });

  it('상태를 저장하고 읽을 수 있다', async () => {
    const original = makeState();
    await saveState(original, tempDir);

    const loaded = await loadState(tempDir);
    expect(loaded).toEqual(original);
  });

  it('디렉터리가 없어도 저장 시 자동 생성한다', async () => {
    const nested = join(tempDir, 'nested', 'dir');
    const state = makeState();
    await saveState(state, nested);

    const loaded = await loadState(nested);
    expect(loaded).toEqual(state);
  });

  it('특정 태스크 상태를 업데이트한다', async () => {
    await saveState(makeState(), tempDir);

    const updated = await updateTaskState(tempDir, 'task-a', {
      status: 'completed',
      branch: 'autopilot/task-a',
      prNumber: 7,
    });

    const task = updated.tasks.find((t) => t.id === 'task-a');
    expect(task?.status).toBe('completed');
    expect(task?.branch).toBe('autopilot/task-a');
    expect(task?.prNumber).toBe(7);
  });

  it('존재하지 않는 태스크 업데이트 시 에러를 던진다', async () => {
    await saveState(makeState(), tempDir);

    await expect(
      updateTaskState(tempDir, 'nonexistent', { status: 'completed' }),
    ).rejects.toThrow('not found');
  });

  it('상태 파일이 없을 때 업데이트 시 에러를 던진다', async () => {
    await expect(
      updateTaskState(tempDir, 'task-a', { status: 'completed' }),
    ).rejects.toThrow('not found');
  });
});

describe('createInitialState', () => {
  it('초기 상태를 생성한다', () => {
    const state = createInitialState('plan.md', ['a', 'b', 'c']);

    expect(state.planSource).toBe('plan.md');
    expect(state.tasks).toHaveLength(3);
    expect(state.tasks.every((t) => t.status === 'pending')).toBe(true);
    expect(state.rateLimited).toBe(false);
  });
});
