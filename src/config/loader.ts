import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { AutopilotConfig } from '../types.js';

const GLOBAL_CONFIG_PATH = join(homedir(), '.claude-autopilot', 'config.json');
const PROJECT_CONFIG_NAME = '.autopilotrc.json';

const DEFAULT_CONFIG: AutopilotConfig = {
  defaultMode: 'auto',
  codeReview: { strategy: 'ai', maxRevisions: 3 },
  merge: { strategy: 'auto', method: 'squash' },
  git: { baseBranch: 'dev', branchPrefix: 'autopilot/' },
  parallel: { maxConcurrent: 3, useContextSync: false },
  validation: { typecheck: true, test: true, build: false, maxRetries: 3 },
  rateLimit: { healthCheckInterval: 60, autoResume: true },
  system: { preventSleep: true },
  source: { type: 'markdown', githubLabel: 'autopilot' },
  visual: { terminal: 'auto' },
};

async function readJsonFile(path: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    const baseVal = base[key];
    const overVal = override[key];
    if (
      baseVal && overVal &&
      typeof baseVal === 'object' && !Array.isArray(baseVal) &&
      typeof overVal === 'object' && !Array.isArray(overVal)
    ) {
      result[key] = deepMerge(baseVal as Record<string, unknown>, overVal as Record<string, unknown>);
    } else {
      result[key] = overVal;
    }
  }
  return result;
}

export async function loadConfig(cwd: string): Promise<AutopilotConfig> {
  let config: Record<string, unknown> = { ...DEFAULT_CONFIG } as unknown as Record<string, unknown>;

  const globalConfig = await readJsonFile(GLOBAL_CONFIG_PATH);
  if (globalConfig) {
    config = deepMerge(config, globalConfig);
  }

  const projectConfig = await readJsonFile(join(cwd, PROJECT_CONFIG_NAME));
  if (projectConfig) {
    config = deepMerge(config, projectConfig);
  }

  return config as unknown as AutopilotConfig;
}

export { DEFAULT_CONFIG };
