import type { PRReviewState } from '../types.js';

export type GhRunner = (
  args: string[],
  cwd: string,
) => Promise<{ stdout: string; exitCode: number }>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getPRReviewState(
  prNumber: number,
  cwd: string,
  gh: GhRunner,
): Promise<PRReviewState> {
  const result = await gh(
    ['pr', 'view', String(prNumber), '--json', 'reviewDecision', '-q', '.reviewDecision'],
    cwd,
  );

  const decision = result.stdout.trim().toUpperCase();

  if (decision === 'APPROVED') return 'APPROVED';
  if (decision === 'CHANGES_REQUESTED') return 'CHANGES_REQUESTED';
  return 'PENDING';
}

export async function pollPRStatus(
  prNumber: number,
  cwd: string,
  gh: GhRunner,
  intervalMs: number = 30_000,
): Promise<PRReviewState> {
  while (true) {
    const state = await getPRReviewState(prNumber, cwd, gh);
    if (state !== 'PENDING') return state;
    await sleep(intervalMs);
  }
}
