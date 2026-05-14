import { describe, it, expect } from 'vitest';
import { parseGithubIssues, type GhRunner } from '../../src/parser/github.js';

function makeGh(issues: object[]): GhRunner {
  return async () => ({ stdout: JSON.stringify(issues), exitCode: 0 });
}

describe('parseGithubIssues', () => {
  it('이슈를 Task로 변환한다', async () => {
    const gh = makeGh([
      {
        number: 1,
        title: '로그인 UI 구현',
        body: 'Apple/Google 버튼 추가',
        labels: [{ name: 'autopilot' }, { name: 'auto' }],
      },
    ]);

    const tasks = await parseGithubIssues('owner/repo', 'autopilot', 'auto', '/tmp', gh);

    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe('issue-1');
    expect(tasks[0].description).toBe('로그인 UI 구현');
    expect(tasks[0].mode).toBe('auto');
  });

  it('review label이 있으면 review 모드로 설정한다', async () => {
    const gh = makeGh([
      {
        number: 2,
        title: '결제 로직',
        body: '상세 명세',
        labels: [{ name: 'autopilot' }, { name: 'review' }],
      },
    ]);

    const tasks = await parseGithubIssues('owner/repo', 'autopilot', 'auto', '/tmp', gh);
    expect(tasks[0].mode).toBe('review');
  });

  it('label이 없으면 defaultMode를 사용한다', async () => {
    const gh = makeGh([
      {
        number: 3,
        title: '태스크',
        body: '설명',
        labels: [{ name: 'autopilot' }],
      },
    ]);

    const tasks = await parseGithubIssues('owner/repo', 'autopilot', 'review', '/tmp', gh);
    expect(tasks[0].mode).toBe('review');
  });

  it('body에서 depends를 추출한다', async () => {
    const gh = makeGh([
      {
        number: 4,
        title: '프로필',
        body: 'depends: issue-1, issue-2\n상세 설명',
        labels: [{ name: 'autopilot' }],
      },
    ]);

    const tasks = await parseGithubIssues('owner/repo', 'autopilot', 'auto', '/tmp', gh);
    expect(tasks[0].dependencies).toEqual(['issue-1', 'issue-2']);
  });

  it('gh 실패 시 에러를 던진다', async () => {
    const gh: GhRunner = async () => ({ stdout: '', exitCode: 1 });

    await expect(
      parseGithubIssues('owner/repo', 'autopilot', 'auto', '/tmp', gh),
    ).rejects.toThrow('Failed to fetch');
  });
});
