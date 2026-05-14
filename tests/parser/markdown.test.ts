import { describe, it, expect } from 'vitest';
import { parseMarkdownString } from '../../src/parser/markdown.js';

describe('parseMarkdownString', () => {
  it('기본 태스크를 파싱한다', () => {
    const md = '- [ ] [id: auth-ui] [auto] 소셜 로그인 UI — Apple/Google 버튼 추가';
    const tasks = parseMarkdownString(md);

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toEqual({
      id: 'auth-ui',
      description: '소셜 로그인 UI',
      detail: 'Apple/Google 버튼 추가',
      mode: 'auto',
      status: 'pending',
      dependencies: [],
    });
  });

  it('review 모드와 의존성을 파싱한다', () => {
    const md =
      '- [ ] [id: auth-flow] [review] (depends: auth-ui) 인증 플로우 — AuthService 연결';
    const tasks = parseMarkdownString(md);

    expect(tasks).toHaveLength(1);
    expect(tasks[0].mode).toBe('review');
    expect(tasks[0].dependencies).toEqual(['auth-ui']);
  });

  it('복수 의존성을 파싱한다', () => {
    const md =
      '- [ ] [id: profile] [auto] (depends: auth-ui, auth-flow) 프로필 화면 — 이름, 이미지';
    const tasks = parseMarkdownString(md);

    expect(tasks[0].dependencies).toEqual(['auth-ui', 'auth-flow']);
  });

  it('detail이 없는 태스크를 파싱한다', () => {
    const md = '- [ ] [id: cleanup] [auto] 코드 정리';
    const tasks = parseMarkdownString(md);

    expect(tasks[0].description).toBe('코드 정리');
    expect(tasks[0].detail).toBe('');
  });

  it('여러 줄의 마크다운에서 태스크만 추출한다', () => {
    const md = `# Feature Plan

## Phase 1: Auth
- [ ] [id: auth-ui] [auto] 로그인 UI — 버튼 추가
- [ ] [id: auth-flow] [review] (depends: auth-ui) 인증 플로우 — AuthService 연결

## Phase 2: Profile
- [ ] [id: profile-ui] [auto] (depends: auth-flow) 프로필 화면 — 이름, 이미지

이것은 일반 텍스트입니다.
`;
    const tasks = parseMarkdownString(md);

    expect(tasks).toHaveLength(3);
    expect(tasks[0].id).toBe('auth-ui');
    expect(tasks[1].id).toBe('auth-flow');
    expect(tasks[2].id).toBe('profile-ui');
  });

  it('체크된 태스크([x])도 파싱한다', () => {
    const md = '- [x] [id: done-task] [auto] 완료된 태스크 — 상세';
    const tasks = parseMarkdownString(md);

    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe('done-task');
  });

  it('형식에 맞지 않는 줄은 무시한다', () => {
    const md = `- [ ] 일반 체크리스트
- [ ] [id: valid] [auto] 유효한 태스크 — 상세
- 그냥 목록`;
    const tasks = parseMarkdownString(md);

    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe('valid');
  });
});
