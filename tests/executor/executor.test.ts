import { describe, it, expect } from 'vitest';
import { buildPrompt, isRateLimited } from '../../src/executor/executor.js';
import type { Task } from '../../src/types.js';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'test-task',
    description: '테스트 태스크',
    detail: '상세 설명',
    mode: 'auto',
    status: 'pending',
    dependencies: [],
    ...overrides,
  };
}

describe('buildPrompt', () => {
  it('task 정보를 포함한 프롬프트를 생성한다', () => {
    const task = makeTask({ id: 'auth-ui', description: '로그인 UI', detail: '버튼 추가' });
    const prompt = buildPrompt(task, '/project');

    expect(prompt).toContain('auth-ui');
    expect(prompt).toContain('로그인 UI');
    expect(prompt).toContain('버튼 추가');
    expect(prompt).toContain('/project');
  });

  it('detail이 없으면 Detail 라인을 생략한다', () => {
    const task = makeTask({ detail: '' });
    const prompt = buildPrompt(task, '/project');

    expect(prompt).not.toContain('Detail:');
  });

  it('description과 instructions를 포함한다', () => {
    const task = makeTask({ description: 'API 구현' });
    const prompt = buildPrompt(task, '/project');

    expect(prompt).toContain('Description: API 구현');
    expect(prompt).toContain('Instructions:');
  });
});

describe('isRateLimited', () => {
  it('rate limit 메시지를 감지한다', () => {
    expect(isRateLimited('Error: rate limit exceeded')).toBe(true);
    expect(isRateLimited('HTTP 429 Too Many Requests')).toBe(true);
    expect(isRateLimited('too many requests')).toBe(true);
    expect(isRateLimited('quota exceeded for model')).toBe(true);
  });

  it('일반 에러는 rate limit으로 판단하지 않는다', () => {
    expect(isRateLimited('TypeError: undefined is not a function')).toBe(false);
    expect(isRateLimited('compilation failed')).toBe(false);
    expect(isRateLimited('')).toBe(false);
  });
});
