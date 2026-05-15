import { readFile } from 'node:fs/promises';
import type { Task, TaskMode } from '../types.js';

const TASK_LINE_RE =
  /^-\s+\[[ x]\]\s+\[id:\s*([^\]]+)\]\s+\[(auto|review)\]\s*(?:\(depends:\s*([^)]+)\)\s*)?(.+)$/;

const PHASE_RE = /^##\s+(.+)/;

function parseLine(line: string, currentPhase: string | undefined): Task | null {
  const match = line.trim().match(TASK_LINE_RE);
  if (!match) return null;

  const [, id, mode, rawDeps, rest] = match;

  const dependencies = rawDeps
    ? rawDeps.split(',').map((d) => d.trim()).filter(Boolean)
    : [];

  const emDashIndex = rest.indexOf('—');
  let description: string;
  let detail: string;

  if (emDashIndex !== -1) {
    description = rest.slice(0, emDashIndex).trim();
    detail = rest.slice(emDashIndex + 1).trim();
  } else {
    description = rest.trim();
    detail = '';
  }

  return {
    id: id.trim(),
    description,
    detail,
    mode: mode as TaskMode,
    status: 'pending',
    dependencies,
    phase: currentPhase,
  };
}

export function parseMarkdownString(content: string): Task[] {
  const tasks: Task[] = [];
  let currentPhase: string | undefined;

  for (const line of content.split('\n')) {
    const phaseMatch = line.match(PHASE_RE);
    if (phaseMatch) {
      currentPhase = phaseMatch[1].trim();
      continue;
    }

    const task = parseLine(line, currentPhase);
    if (task) tasks.push(task);
  }

  return tasks;
}

export async function parseMarkdownFile(filePath: string): Promise<Task[]> {
  const content = await readFile(filePath, 'utf-8');
  return parseMarkdownString(content);
}
