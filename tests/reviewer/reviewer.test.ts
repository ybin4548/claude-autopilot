import { describe, it, expect } from 'vitest';
import { getPRReviewState, pollPRStatus, type GhRunner } from '../../src/reviewer/reviewer.js';

function makeGh(stdout: string): GhRunner {
  return async () => ({ stdout, exitCode: 0 });
}

describe('getPRReviewState', () => {
  it('APPROVED를 반환한다', async () => {
    const state = await getPRReviewState(1, '/tmp', makeGh('APPROVED'));
    expect(state).toBe('APPROVED');
  });

  it('CHANGES_REQUESTED를 반환한다', async () => {
    const state = await getPRReviewState(1, '/tmp', makeGh('CHANGES_REQUESTED'));
    expect(state).toBe('CHANGES_REQUESTED');
  });

  it('빈 응답은 PENDING으로 반환한다', async () => {
    const state = await getPRReviewState(1, '/tmp', makeGh(''));
    expect(state).toBe('PENDING');
  });

  it('대소문자를 무시한다', async () => {
    const state = await getPRReviewState(1, '/tmp', makeGh('approved'));
    expect(state).toBe('APPROVED');
  });
});

describe('pollPRStatus', () => {
  it('PENDING이 아닌 상태가 되면 즉시 반환한다', async () => {
    let calls = 0;
    const gh: GhRunner = async () => {
      calls++;
      return { stdout: calls >= 2 ? 'APPROVED' : '', exitCode: 0 };
    };

    const state = await pollPRStatus(1, '/tmp', gh, 10);
    expect(state).toBe('APPROVED');
    expect(calls).toBe(2);
  });
});
