import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  waitForRateLimit,
  markRateLimited,
  isRateLimited,
} from '../../src/rate-limiter/limiter.js';
import { saveState, loadState } from '../../src/state/state.js';
import type { AutopilotState, AutopilotConfig } from '../../src/types.js';

let tempDir: string;

function makeState(): AutopilotState {
  return {
    planSource: 'plan.md',
    startedAt: '2026-05-15T10:00:00Z',
    tasks: [{ id: 'task-a', status: 'in-progress' }],
    rateLimited: false,
    lastHealthCheck: null,
  };
}

function makeConfig(): Pick<AutopilotConfig, 'rateLimit'> {
  return {
    rateLimit: {
      healthCheckInterval: 0.01,
      autoResume: true,
    },
  };
}

describe('rate limiter', () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'autopilot-rl-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('헬스체크 성공 시 rateLimited를 false로 복원하고 반환한다', async () => {
    const state = makeState();
    await saveState(state, tempDir);

    let calls = 0;
    const healthCheck = async () => {
      calls++;
      return calls >= 2;
    };

    await waitForRateLimit(state, makeConfig(), tempDir, healthCheck);

    const saved = await loadState(tempDir);
    expect(saved?.rateLimited).toBe(false);
    expect(saved?.lastHealthCheck).not.toBeNull();
    expect(calls).toBe(2);
  });

  it('대기 중 상태를 rateLimited: true로 저장한다', async () => {
    const state = makeState();
    await saveState(state, tempDir);

    let savedDuringWait: AutopilotState | null = null;
    let calls = 0;
    const healthCheck = async () => {
      calls++;
      if (calls === 1) {
        savedDuringWait = await loadState(tempDir);
      }
      return calls >= 2;
    };

    await waitForRateLimit(state, makeConfig(), tempDir, healthCheck);

    expect(savedDuringWait?.rateLimited).toBe(true);
  });
});

describe('markRateLimited', () => {
  it('상태의 rateLimited를 true로 설정한다', () => {
    const state = makeState();
    const marked = markRateLimited(state);

    expect(marked.rateLimited).toBe(true);
    expect(state.rateLimited).toBe(false);
  });
});

describe('isRateLimited', () => {
  it('rateLimited 필드를 반환한다', () => {
    expect(isRateLimited(makeState())).toBe(false);
    expect(isRateLimited({ ...makeState(), rateLimited: true })).toBe(true);
  });
});
