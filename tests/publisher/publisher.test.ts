import { describe, it, expect, beforeEach } from 'vitest';
import {
  createBranch,
  commitChanges,
  pushBranch,
  createPR,
  mergePR,
  publish,
  type PublisherDeps,
} from '../../src/publisher/publisher.js';
import type { Task, AutopilotConfig } from '../../src/types.js';

let gitCalls: string[][] = [];
let ghCalls: string[][] = [];

function makeDeps(overrides?: {
  ghStdout?: string;
}): PublisherDeps {
  return {
    git: async (args) => {
      gitCalls.push(args);
      return { stdout: '', exitCode: 0 };
    },
    gh: async (args) => {
      ghCalls.push(args);
      return { stdout: overrides?.ghStdout ?? 'https://github.com/org/repo/pull/42', exitCode: 0 };
    },
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'auth-ui',
    description: '로그인 UI 구현',
    detail: 'Apple/Google 버튼 추가',
    mode: 'auto',
    status: 'pending',
    dependencies: [],
    ...overrides,
  };
}

function makeConfig(
  overrides?: Partial<AutopilotConfig['git'] & AutopilotConfig['merge']>,
): Pick<AutopilotConfig, 'git' | 'merge'> {
  return {
    git: {
      baseBranch: 'dev',
      branchPrefix: 'autopilot/',
    },
    merge: {
      strategy: 'auto',
      method: 'squash',
    },
  };
}

describe('createBranch', () => {
  beforeEach(() => { gitCalls = []; ghCalls = []; });

  it('config의 prefix + taskId로 브랜치를 생성한다', async () => {
    const branch = await createBranch('auth-ui', makeConfig(), '/tmp', makeDeps());

    expect(branch).toBe('autopilot/auth-ui');
    expect(gitCalls[0]).toEqual(['checkout', '-b', 'autopilot/auth-ui', 'dev']);
  });
});

describe('commitChanges', () => {
  beforeEach(() => { gitCalls = []; ghCalls = []; });

  it('git add -A와 commit을 실행한다', async () => {
    await commitChanges('auth-ui', '/tmp', makeDeps());

    expect(gitCalls[0]).toEqual(['add', '-A']);
    expect(gitCalls[1][0]).toBe('commit');
    expect(gitCalls[1][2]).toContain('auth-ui');
  });
});

describe('pushBranch', () => {
  beforeEach(() => { gitCalls = []; ghCalls = []; });

  it('origin에 브랜치를 push한다', async () => {
    await pushBranch('autopilot/auth-ui', '/tmp', makeDeps());

    expect(gitCalls[0]).toEqual(['push', '-u', 'origin', 'autopilot/auth-ui']);
  });
});

describe('createPR', () => {
  beforeEach(() => { gitCalls = []; ghCalls = []; });

  it('gh pr create로 PR을 생성하고 번호를 파싱한다', async () => {
    const task = makeTask();
    const deps = makeDeps({ ghStdout: 'https://github.com/org/repo/pull/7' });
    const result = await createPR(task, 'autopilot/auth-ui', makeConfig(), '/tmp', deps);

    expect(result.prNumber).toBe(7);
    expect(result.prUrl).toBe('https://github.com/org/repo/pull/7');
    expect(ghCalls[0]).toContain('pr');
    expect(ghCalls[0]).toContain('create');
  });
});

describe('mergePR', () => {
  beforeEach(() => { gitCalls = []; ghCalls = []; });

  it('squash merge를 실행한다', async () => {
    await mergePR(7, makeConfig(), '/tmp', makeDeps());

    expect(ghCalls[0]).toContain('--squash');
    expect(ghCalls[0]).toContain('7');
  });
});

describe('publish', () => {
  beforeEach(() => { gitCalls = []; ghCalls = []; });

  it('auto 모드: 브랜치 생성 → 커밋 → push → PR → 머지', async () => {
    const task = makeTask({ mode: 'auto' });
    const result = await publish(task, makeConfig(), '/tmp', makeDeps());

    expect(result.branch).toBe('autopilot/auth-ui');
    expect(result.prNumber).toBe(42);
    expect(result.merged).toBe(true);
    expect(ghCalls).toHaveLength(2); // createPR + mergePR
  });

  it('review 모드: 브랜치 생성 → 커밋 → push → PR 생성만', async () => {
    const task = makeTask({ mode: 'review' });
    const result = await publish(task, makeConfig(), '/tmp', makeDeps());

    expect(result.branch).toBe('autopilot/auth-ui');
    expect(result.prNumber).toBe(42);
    expect(result.merged).toBe(false);
    expect(ghCalls).toHaveLength(1); // createPR only
  });
});
