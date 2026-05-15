import { createInterface } from 'node:readline';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { AutopilotConfig } from '../types.js';
import { DEFAULT_CONFIG } from './loader.js';

const CONFIG_DIR = join(homedir(), '.claude-autopilot');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

interface Question {
  key: string;
  prompt: string;
  options: Array<{ value: string; label: string; recommended?: boolean }>;
  freeInput?: boolean;
}

const QUESTIONS: Question[] = [
  {
    key: 'defaultMode',
    prompt: 'Default task mode?',
    options: [
      { value: 'auto', label: 'Automatic merge after tests pass', recommended: true },
      { value: 'review', label: 'Create PR and wait for human approval' },
    ],
  },
  {
    key: 'codeReview.strategy',
    prompt: 'Code review strategy?',
    options: [
      { value: 'none', label: 'No review, merge directly' },
      { value: 'ai', label: 'AI reviews code before merge', recommended: true },
      { value: 'human', label: 'Wait for human review' },
    ],
  },
  {
    key: 'merge.method',
    prompt: 'Merge method?',
    options: [
      { value: 'squash', label: 'Squash merge', recommended: true },
      { value: 'merge', label: 'Merge commit' },
      { value: 'rebase', label: 'Rebase' },
    ],
  },
  {
    key: 'git.baseBranch',
    prompt: 'PR target branch?',
    options: [],
    freeInput: true,
  },
  {
    key: 'parallel.maxConcurrent',
    prompt: 'Max parallel sessions?',
    options: [],
    freeInput: true,
  },
  {
    key: 'visual.terminal',
    prompt: 'Terminal for visual mode?',
    options: [
      { value: 'auto', label: 'Auto-detect (tmux > iTerm > Terminal.app)', recommended: true },
      { value: 'tmux', label: 'tmux' },
      { value: 'iterm', label: 'iTerm2' },
      { value: 'terminal-app', label: 'macOS Terminal.app' },
    ],
  },
  {
    key: 'system.preventSleep',
    prompt: 'Prevent sleep when lid is closed?',
    options: [
      { value: 'true', label: 'Keep running with lid closed', recommended: true },
      { value: 'false', label: 'Pause when lid is closed' },
    ],
  },
];

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!current[keys[i]] || typeof current[keys[i]] !== 'object') {
      current[keys[i]] = {};
    }
    current = current[keys[i]] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
}

function ask(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

export async function runConfigWizard(): Promise<AutopilotConfig> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log('\nWelcome to claude-autopilot!');
  console.log('Let\'s configure your preferences.\n');

  const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as Record<string, unknown>;

  for (let i = 0; i < QUESTIONS.length; i++) {
    const q = QUESTIONS[i];
    console.log(`${i + 1}. ${q.prompt}`);

    if (q.freeInput) {
      const defaultVal = q.key === 'git.baseBranch' ? 'dev' : '3';
      const answer = await ask(rl, `   > [${defaultVal}]: `);
      const value = answer.trim() || defaultVal;

      if (q.key === 'parallel.maxConcurrent') {
        setNestedValue(config, q.key, parseInt(value, 10));
      } else {
        setNestedValue(config, q.key, value);
      }
    } else {
      for (let j = 0; j < q.options.length; j++) {
        const opt = q.options[j];
        const rec = opt.recommended ? ' (Recommended)' : '';
        console.log(`   ${j + 1}) [${opt.value}] ${opt.label}${rec}`);
      }

      const answer = await ask(rl, `   > Choose [1-${q.options.length}]: `);
      const idx = parseInt(answer.trim(), 10) - 1;
      const selected = q.options[idx] ?? q.options.find((o) => o.recommended) ?? q.options[0];

      let value: unknown = selected.value;
      if (value === 'true') value = true;
      if (value === 'false') value = false;

      setNestedValue(config, q.key, value);
    }

    console.log();
  }

  rl.close();

  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');

  console.log(`Configuration saved to ${CONFIG_PATH}`);
  console.log('You can change these anytime with: claude-autopilot config\n');

  return config as unknown as AutopilotConfig;
}

export async function setConfigValue(keyValue: string): Promise<void> {
  const [key, value] = keyValue.split('=');
  if (!key || value === undefined) {
    console.error('Usage: claude-autopilot config --set key=value');
    process.exit(1);
  }

  const { loadConfig } = await import('./loader.js');
  const config = await loadConfig(process.cwd());
  const obj = config as unknown as Record<string, unknown>;

  let parsed: unknown = value;
  if (value === 'true') parsed = true;
  else if (value === 'false') parsed = false;
  else if (/^\d+$/.test(value)) parsed = parseInt(value, 10);

  setNestedValue(obj, key, parsed);

  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(obj, null, 2), 'utf-8');

  console.log(`Set ${key} = ${value}`);
}
