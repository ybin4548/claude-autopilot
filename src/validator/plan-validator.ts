import type {
  Task,
  TaskValidation,
  ValidationVerdict,
  PlanValidationReport,
} from '../types.js';

const VAGUE_TERMS = [
  '개선',
  '리팩토링',
  '정리',
  '수정',
  '보완',
  'improve',
  'refactor',
  'cleanup',
  'clean up',
  'fix up',
  'enhance',
  'optimize',
  'update',
];

const VAGUE_RE = new RegExp(
  VAGUE_TERMS.map((t) => `\\b${t}\\b`).join('|'),
  'i',
);

function validateTask(task: Task, allIds: Set<string>): TaskValidation {
  const reasons: string[] = [];
  let worst: ValidationVerdict = 'pass';

  function add(verdict: ValidationVerdict, reason: string) {
    reasons.push(reason);
    if (verdict === 'fail') worst = 'fail';
    else if (verdict === 'warn' && worst !== 'fail') worst = 'warn';
  }

  if (!task.description) {
    add('fail', 'description이 비어 있습니다');
  }

  if (!task.detail) {
    add('warn', 'detail(상세 명세)이 없습니다 — 추정 기반으로 실행됩니다');
  }

  for (const dep of task.dependencies) {
    if (!allIds.has(dep)) {
      add('fail', `의존성 "${dep}"에 해당하는 태스크가 존재하지 않습니다`);
    }
  }

  if (task.dependencies.includes(task.id)) {
    add('fail', '자기 자신을 의존성으로 참조합니다');
  }

  if (VAGUE_RE.test(task.description) && !task.detail) {
    add('warn', `description에 모호한 표현이 포함되어 있습니다: "${task.description}"`);
  }

  return { taskId: task.id, verdict: worst, reasons };
}

function detectCycles(tasks: Task[]): string[][] {
  const graph = new Map<string, string[]>();
  for (const t of tasks) {
    graph.set(t.id, t.dependencies);
  }

  const cycles: string[][] = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(node: string, path: string[]): void {
    if (inStack.has(node)) {
      const cycleStart = path.indexOf(node);
      cycles.push(path.slice(cycleStart).concat(node));
      return;
    }
    if (visited.has(node)) return;

    visited.add(node);
    inStack.add(node);
    path.push(node);

    for (const dep of graph.get(node) ?? []) {
      dfs(dep, path);
    }

    path.pop();
    inStack.delete(node);
  }

  for (const id of graph.keys()) {
    dfs(id, []);
  }

  return cycles;
}

export function validatePlan(tasks: Task[]): PlanValidationReport {
  const allIds = new Set(tasks.map((t) => t.id));

  const duplicates = tasks
    .map((t) => t.id)
    .filter((id, i, arr) => arr.indexOf(id) !== i);

  const validations: TaskValidation[] = tasks.map((t) =>
    validateTask(t, allIds),
  );

  for (const dup of [...new Set(duplicates)]) {
    const existing = validations.find((v) => v.taskId === dup);
    if (existing) {
      existing.verdict = 'fail';
      existing.reasons.push(`ID "${dup}"가 중복됩니다`);
    }
  }

  const cycles = detectCycles(tasks);
  for (const cycle of cycles) {
    const firstId = cycle[0];
    const existing = validations.find((v) => v.taskId === firstId);
    if (existing) {
      existing.verdict = 'fail';
      existing.reasons.push(`순환 의존성이 감지되었습니다: ${cycle.join(' → ')}`);
    }
  }

  const passCount = validations.filter((v) => v.verdict === 'pass').length;
  const warnCount = validations.filter((v) => v.verdict === 'warn').length;
  const failCount = validations.filter((v) => v.verdict === 'fail').length;
  const total = validations.length;
  const score = total > 0 ? Math.round((passCount / total) * 100) : 0;

  return { validations, passCount, warnCount, failCount, score };
}
