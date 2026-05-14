import { describe, it, expect } from 'vitest';
import { topologicalSort, buildParallelGroups } from '../../src/queue/queue.js';
import type { Task } from '../../src/types.js';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'test',
    description: '테스트',
    detail: '',
    mode: 'auto',
    status: 'pending',
    dependencies: [],
    ...overrides,
  };
}

describe('topologicalSort', () => {
  it('의존성이 없는 태스크를 정렬한다', () => {
    const tasks = [
      makeTask({ id: 'a' }),
      makeTask({ id: 'b' }),
    ];
    const sorted = topologicalSort(tasks);

    expect(sorted.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('의존성 순서대로 정렬한다', () => {
    const tasks = [
      makeTask({ id: 'b', dependencies: ['a'] }),
      makeTask({ id: 'a' }),
    ];
    const sorted = topologicalSort(tasks);

    expect(sorted.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('복잡한 의존성 그래프를 정렬한다', () => {
    const tasks = [
      makeTask({ id: 'c', dependencies: ['a', 'b'] }),
      makeTask({ id: 'a' }),
      makeTask({ id: 'b', dependencies: ['a'] }),
    ];
    const sorted = topologicalSort(tasks);
    const ids = sorted.map((t) => t.id);

    expect(ids.indexOf('a')).toBeLessThan(ids.indexOf('b'));
    expect(ids.indexOf('a')).toBeLessThan(ids.indexOf('c'));
    expect(ids.indexOf('b')).toBeLessThan(ids.indexOf('c'));
  });

  it('순환 의존성이 있으면 에러를 던진다', () => {
    const tasks = [
      makeTask({ id: 'a', dependencies: ['b'] }),
      makeTask({ id: 'b', dependencies: ['a'] }),
    ];

    expect(() => topologicalSort(tasks)).toThrow('순환');
  });
});

describe('buildParallelGroups', () => {
  it('독립 태스크를 하나의 그룹으로 묶는다', () => {
    const tasks = [
      makeTask({ id: 'a' }),
      makeTask({ id: 'b' }),
      makeTask({ id: 'c' }),
    ];
    const groups = buildParallelGroups(tasks);

    expect(groups).toHaveLength(1);
    expect(groups[0].map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('의존 태스크를 다음 그룹으로 분리한다', () => {
    const tasks = [
      makeTask({ id: 'a' }),
      makeTask({ id: 'b', dependencies: ['a'] }),
    ];
    const groups = buildParallelGroups(tasks);

    expect(groups).toHaveLength(2);
    expect(groups[0].map((t) => t.id)).toEqual(['a']);
    expect(groups[1].map((t) => t.id)).toEqual(['b']);
  });

  it('복잡한 의존 그래프를 올바르게 그룹화한다', () => {
    // a, b는 독립 → group 0
    // c는 a에 의존 → group 1
    // d는 b에 의존 → group 1
    // e는 c, d에 의존 → group 2
    const tasks = [
      makeTask({ id: 'a' }),
      makeTask({ id: 'b' }),
      makeTask({ id: 'c', dependencies: ['a'] }),
      makeTask({ id: 'd', dependencies: ['b'] }),
      makeTask({ id: 'e', dependencies: ['c', 'd'] }),
    ];
    const groups = buildParallelGroups(tasks);

    expect(groups).toHaveLength(3);
    expect(groups[0].map((t) => t.id).sort()).toEqual(['a', 'b']);
    expect(groups[1].map((t) => t.id).sort()).toEqual(['c', 'd']);
    expect(groups[2].map((t) => t.id)).toEqual(['e']);
  });

  it('직렬 체인은 각각 별도 그룹이 된다', () => {
    const tasks = [
      makeTask({ id: 'a' }),
      makeTask({ id: 'b', dependencies: ['a'] }),
      makeTask({ id: 'c', dependencies: ['b'] }),
    ];
    const groups = buildParallelGroups(tasks);

    expect(groups).toHaveLength(3);
    expect(groups[0][0].id).toBe('a');
    expect(groups[1][0].id).toBe('b');
    expect(groups[2][0].id).toBe('c');
  });
});
