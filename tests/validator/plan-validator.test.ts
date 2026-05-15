import { describe, it, expect } from 'vitest';
import { validatePlan } from '../../src/validator/plan-validator.js';
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

describe('validatePlan', () => {
  it('완전한 태스크는 pass를 반환한다', () => {
    const tasks = [makeTask()];
    const report = validatePlan(tasks);

    expect(report.passCount).toBe(1);
    expect(report.failCount).toBe(0);
    expect(report.score).toBe(100);
  });

  it('description이 없으면 fail을 반환한다', () => {
    const tasks = [makeTask({ description: '' })];
    const report = validatePlan(tasks);

    expect(report.failCount).toBe(1);
    expect(report.validations[0].verdict).toBe('fail');
  });

  it('detail이 없으면 warn을 반환한다', () => {
    const tasks = [makeTask({ detail: '' })];
    const report = validatePlan(tasks);

    expect(report.warnCount).toBe(1);
    expect(report.validations[0].verdict).toBe('warn');
  });

  it('존재하지 않는 의존성은 fail을 반환한다', () => {
    const tasks = [makeTask({ dependencies: ['nonexistent'] })];
    const report = validatePlan(tasks);

    expect(report.failCount).toBe(1);
  });

  it('자기 자신 참조는 fail을 반환한다', () => {
    const tasks = [makeTask({ id: 'self', dependencies: ['self'] })];
    const report = validatePlan(tasks);

    expect(report.failCount).toBe(1);
  });

  it('순환 의존성을 감지한다', () => {
    const tasks = [
      makeTask({ id: 'a', dependencies: ['b'] }),
      makeTask({ id: 'b', dependencies: ['a'] }),
    ];
    const report = validatePlan(tasks);

    const hasCircular = report.validations.some((v) =>
      v.reasons.some((r) => r.includes('순환')),
    );
    expect(hasCircular).toBe(true);
  });

  it('중복 ID를 감지한다', () => {
    const tasks = [
      makeTask({ id: 'dup' }),
      makeTask({ id: 'dup' }),
    ];
    const report = validatePlan(tasks);

    const hasDup = report.validations.some((v) =>
      v.reasons.some((r) => r.includes('중복')),
    );
    expect(hasDup).toBe(true);
  });

  it('모호한 표현 + detail 없음은 warn을 반환한다', () => {
    const tasks = [makeTask({ description: '성능 개선', detail: '' })];
    const report = validatePlan(tasks);

    expect(report.warnCount).toBe(1);
  });

  it('모호한 표현이 있어도 detail이 있으면 경고하지 않는다', () => {
    const tasks = [makeTask({ description: '성능 개선', detail: 'API 응답 캐싱 추가' })];
    const report = validatePlan(tasks);

    expect(report.passCount).toBe(1);
  });

  it('score를 올바르게 계산한다', () => {
    const tasks = [
      makeTask({ id: 'a' }),
      makeTask({ id: 'b' }),
      makeTask({ id: 'c', description: '' }),
    ];
    const report = validatePlan(tasks);

    expect(report.passCount).toBe(2);
    expect(report.failCount).toBe(1);
    expect(report.score).toBe(67);
  });
});
