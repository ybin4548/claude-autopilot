import type { Task, ParallelGroup } from '../types.js';

export function topologicalSort(tasks: Task[]): Task[] {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const t of tasks) {
    inDegree.set(t.id, 0);
    dependents.set(t.id, []);
  }

  for (const t of tasks) {
    for (const dep of t.dependencies) {
      if (taskMap.has(dep)) {
        inDegree.set(t.id, (inDegree.get(t.id) ?? 0) + 1);
        dependents.get(dep)!.push(t.id);
      }
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: Task[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(taskMap.get(id)!);

    for (const dep of dependents.get(id)!) {
      const newDeg = (inDegree.get(dep) ?? 1) - 1;
      inDegree.set(dep, newDeg);
      if (newDeg === 0) queue.push(dep);
    }
  }

  if (sorted.length !== tasks.length) {
    throw new Error('순환 의존성이 존재하여 실행 순서를 결정할 수 없습니다');
  }

  return sorted;
}

function groupByPhase(tasks: Task[]): Task[][] {
  const phases: Task[][] = [];
  let currentPhase: string | undefined = undefined;
  let currentGroup: Task[] = [];

  for (const task of tasks) {
    if (task.phase !== currentPhase && currentGroup.length > 0) {
      phases.push(currentGroup);
      currentGroup = [];
    }
    currentPhase = task.phase;
    currentGroup.push(task);
  }

  if (currentGroup.length > 0) {
    phases.push(currentGroup);
  }

  return phases;
}

export function buildParallelGroups(tasks: Task[]): ParallelGroup[] {
  const hasPhases = tasks.some((t) => t.phase);

  if (!hasPhases) {
    return buildDependencyGroups(tasks);
  }

  const phaseGroups = groupByPhase(tasks);
  const allGroups: ParallelGroup[] = [];

  for (const phaseTasks of phaseGroups) {
    const groups = buildDependencyGroups(phaseTasks);
    allGroups.push(...groups);
  }

  return allGroups;
}

function buildDependencyGroups(tasks: Task[]): ParallelGroup[] {
  const sorted = topologicalSort(tasks);
  const completedAt = new Map<string, number>();
  const groups: ParallelGroup[] = [];

  for (const task of sorted) {
    let groupIndex = 0;
    for (const dep of task.dependencies) {
      const depGroup = completedAt.get(dep);
      if (depGroup !== undefined) {
        groupIndex = Math.max(groupIndex, depGroup + 1);
      }
    }

    completedAt.set(task.id, groupIndex);

    while (groups.length <= groupIndex) {
      groups.push([]);
    }
    groups[groupIndex].push(task);
  }

  return groups;
}

export function applyMaxConcurrent(groups: ParallelGroup[], maxConcurrent: number): ParallelGroup[] {
  const result: ParallelGroup[] = [];

  for (const group of groups) {
    for (let i = 0; i < group.length; i += maxConcurrent) {
      result.push(group.slice(i, i + maxConcurrent));
    }
  }

  return result;
}
