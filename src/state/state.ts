import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { AutopilotState, TaskState, TaskStatus } from '../types.js';

const DEFAULT_STATE_DIR = join(homedir(), '.claude-autopilot');
const STATE_FILE = 'state.json';

function statePath(stateDir: string): string {
  return join(stateDir, STATE_FILE);
}

export async function loadState(
  stateDir: string = DEFAULT_STATE_DIR,
): Promise<AutopilotState | null> {
  try {
    const raw = await readFile(statePath(stateDir), 'utf-8');
    return JSON.parse(raw) as AutopilotState;
  } catch {
    return null;
  }
}

export async function saveState(
  state: AutopilotState,
  stateDir: string = DEFAULT_STATE_DIR,
): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  await writeFile(statePath(stateDir), JSON.stringify(state, null, 2), 'utf-8');
}

export async function updateTaskState(
  stateDir: string,
  taskId: string,
  update: Partial<TaskState>,
): Promise<AutopilotState> {
  const state = await loadState(stateDir);
  if (!state) {
    throw new Error(`State file not found in ${stateDir}`);
  }

  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) {
    throw new Error(`Task "${taskId}" not found in state`);
  }

  Object.assign(task, update);
  await saveState(state, stateDir);
  return state;
}

export function createInitialState(
  planSource: string,
  taskIds: string[],
): AutopilotState {
  return {
    planSource,
    startedAt: new Date().toISOString(),
    tasks: taskIds.map((id) => ({ id, status: 'pending' as TaskStatus })),
    rateLimited: false,
    lastHealthCheck: null,
  };
}
