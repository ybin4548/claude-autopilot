#!/usr/bin/env node

import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { parseMarkdownFile } from './parser/markdown.js';
import { parseGithubIssues } from './parser/github.js';
import { validatePlan } from './validator/plan-validator.js';
import { runPlan, type OrchestratorDeps } from './orchestrator.js';
import { loadState, saveState, createInitialState } from './state/state.js';
import { defaultCommandRunner } from './validator/validator.js';
import { loadConfig } from './config/loader.js';
import { consoleLogger } from './logger.js';
import { createTerminalAdapter } from './terminal/detect.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AutopilotConfig, Task } from './types.js';
import type { TerminalAdapter } from './terminal/adapter.js';

const STATE_DIR = join(homedir(), '.claude-autopilot');

interface ParsedArgs {
  command: 'run' | 'status' | 'resume' | 'config' | 'init' | 'stop' | 'pause' | 'learn';
  planFile?: string;
  github?: string;
  noVisual?: boolean;
  configSet?: string;
  force?: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const noVisual = args.includes('--no-visual');
  const filtered = args.filter((a) => a !== '--no-visual');
  const command = filtered[0] as ParsedArgs['command'];

  if (!command || !['run', 'status', 'resume', 'config', 'init', 'stop', 'pause', 'learn'].includes(command)) {
    console.log('Usage:');
    console.log('  claude-autopilot run <plan.md>');
    console.log('  claude-autopilot run --github owner/repo');
    console.log('  claude-autopilot run --no-visual <plan.md>');
    console.log('  claude-autopilot status');
    console.log('  claude-autopilot resume');
    console.log('  claude-autopilot stop [--force]');
    console.log('  claude-autopilot pause');
    console.log('  claude-autopilot config');
    console.log('  claude-autopilot config --set key=value');
    console.log('  claude-autopilot init');
    process.exit(1);
  }

  if (command === 'stop') {
    return { command, force: filtered.includes('--force') };
  }

  if (command === 'config') {
    const setIdx = filtered.indexOf('--set');
    if (setIdx !== -1) {
      return { command, configSet: filtered[setIdx + 1] };
    }
    return { command };
  }

  if (command === 'run') {
    const githubIdx = filtered.indexOf('--github');
    if (githubIdx !== -1) {
      return { command, github: filtered[githubIdx + 1], noVisual };
    }
    return { command, planFile: filtered[1], noVisual };
  }

  return { command, noVisual };
}

function makeShellRunner(cmd: string) {
  return async (args: string[], cwd: string) => {
    return new Promise<{ stdout: string; exitCode: number }>((res) => {
      const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
      const chunks: Buffer[] = [];
      child.stdout.on('data', (c: Buffer) => chunks.push(c));
      child.on('close', (code) => {
        res({ stdout: Buffer.concat(chunks).toString('utf-8'), exitCode: code ?? 1 });
      });
    });
  };
}

function makeDeps(terminal?: TerminalAdapter): OrchestratorDeps {
  const gitRunner = makeShellRunner('git');
  const ghRunner = makeShellRunner('gh');
  return {
    publisher: { git: gitRunner, gh: ghRunner },
    commandRunner: defaultCommandRunner,
    ghRunner,
    healthCheck: async () => {
      const result = await ghRunner(['auth', 'status'], process.cwd());
      return result.exitCode === 0;
    },
    logger: consoleLogger,
    terminal,
  };
}

const STATUS_ICONS: Record<string, string> = {
  completed: '[DONE]',
  'in-progress': '[....]',
  pending: '[    ]',
  failed: '[FAIL]',
  interrupted: '[STOP]',
  skipped: '[SKIP]',
};

async function ensureConfig(): Promise<void> {
  const configPath = join(homedir(), '.claude-autopilot', 'config.json');
  try {
    await import('node:fs/promises').then((fs) => fs.stat(configPath));
  } catch {
    const { runConfigWizard } = await import('./config/wizard.js');
    await runConfigWizard();
  }
}

async function commandRun(parsed: ParsedArgs): Promise<void> {
  await ensureConfig();
  const cwd = process.cwd();
  const config = await loadConfig(cwd);
  const log = consoleLogger;

  let tasks: Task[];

  if (parsed.github) {
    const ghRunner = makeShellRunner('gh');
    tasks = await parseGithubIssues(
      parsed.github,
      config.source.githubLabel,
      config.defaultMode,
      cwd,
      ghRunner,
    );
  } else if (parsed.planFile) {
    tasks = await parseMarkdownFile(resolve(cwd, parsed.planFile));
  } else {
    console.error('Error: specify a plan file or --github owner/repo');
    process.exit(1);
  }

  const report = validatePlan(tasks);
  log.planReview(report.passCount, report.warnCount, report.failCount, report.score);

  for (const v of report.validations) {
    if (v.verdict !== 'pass') {
      console.log(`  [${v.verdict.toUpperCase()}] ${v.taskId}: ${v.reasons.join(', ')}`);
    }
  }

  if (report.failCount > 0) {
    const failRatio = report.failCount / report.validations.length;
    if (failRatio > 0.5) {
      console.log(`\nExecution not recommended. Focus on making your plan more specific.`);
    }
    console.log('\nFailed tasks will be skipped.\n');
  }

  const runnableTasks = tasks.filter((t) => {
    const v = report.validations.find((val) => val.taskId === t.id);
    return v?.verdict !== 'fail';
  });

  // y/n confirmation
  if (runnableTasks.length > 0) {
    const { createInterface } = await import('node:readline');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((res) => rl.question(`Proceed with ${runnableTasks.length} tasks? (y/n): `, res));
    rl.close();
    if (answer.trim().toLowerCase() !== 'y') {
      console.log('Aborted.');
      process.exit(0);
    }
  }

  if (runnableTasks.length === 0) {
    console.log('No runnable tasks. Exiting.');
    process.exit(1);
  }

  let terminal: TerminalAdapter | undefined;
  if (!parsed.noVisual) {
    terminal = await createTerminalAdapter(config);
    console.log(`Visual mode: ${terminal.name}`);
  } else {
    console.log(`Visual mode: disabled (--no-visual)`);
  }

  console.log(`Config: validation.typecheck=${config.validation.typecheck}, test=${config.validation.test}, build=${config.validation.build}`);
  console.log(`Config: merge.method=${config.merge.method}, git.baseBranch=${config.git.baseBranch}\n`);

  const { writePid, removePid, setupSignalHandlers } = await import('./process.js');
  await writePid();
  setupSignalHandlers(
    () => { console.log('Will stop after current task...'); },
    () => { removePid().then(() => process.exit(1)); },
  );

  const state = createInitialState(
    parsed.planFile ?? parsed.github ?? 'unknown',
    runnableTasks.map((t) => t.id),
  );
  await saveState(state, STATE_DIR);

  const results = await runPlan(runnableTasks, config, state, STATE_DIR, cwd, makeDeps(terminal));

  if (terminal) await terminal.cleanup();
  await removePid();

  const completed = results.filter((r) => r.outcome === 'completed').length;
  const failed = results.filter((r) => r.outcome === 'failed').length;

  const { notify } = await import('./feedback.js');
  await notify(`Done! ${completed} completed, ${failed} failed.`, config.notifications.channel, config.notifications.webhookUrl);
  log.done(completed, failed);
}

async function commandStatus(): Promise<void> {
  const state = await loadState(STATE_DIR);
  if (!state) {
    console.log('No active run found.');
    return;
  }

  const completed = state.tasks.filter((t) => t.status === 'completed').length;
  const total = state.tasks.length;

  console.log(`\n[claude-autopilot status]\n`);
  console.log(`  Plan: ${state.planSource}`);
  console.log(`  Progress: ${completed}/${total} tasks completed`);
  console.log(`  Rate limit: ${state.rateLimited ? 'RATE LIMITED' : 'OK'}\n`);

  for (const task of state.tasks) {
    const icon = STATUS_ICONS[task.status] ?? '❓';
    const pr = task.prNumber ? ` (PR #${task.prNumber})` : '';
    console.log(`  ${icon} ${task.id} — ${task.status}${pr}`);
  }
  console.log();
}

async function commandResume(): Promise<void> {
  const cwd = process.cwd();
  const config = await loadConfig(cwd);
  const state = await loadState(STATE_DIR);
  if (!state) {
    console.log('No saved state to resume from.');
    return;
  }

  const pendingTasks = state.tasks.filter(
    (t) => t.status === 'pending' || t.status === 'interrupted',
  );

  if (pendingTasks.length === 0) {
    console.log('All tasks are already completed or failed.');
    return;
  }

  const planSource = state.planSource;
  let allTasks: Task[];

  if (planSource.includes('/')) {
    const ghRunner = makeShellRunner('gh');
    allTasks = await parseGithubIssues(
      planSource,
      config.source.githubLabel,
      config.defaultMode,
      cwd,
      ghRunner,
    );
  } else {
    allTasks = await parseMarkdownFile(resolve(cwd, planSource));
  }

  const pendingIds = new Set(pendingTasks.map((t) => t.id));
  const tasksToRun = allTasks.filter((t) => pendingIds.has(t.id));

  let terminal: TerminalAdapter | undefined;
  terminal = await createTerminalAdapter(config);
  console.log(`Visual mode: ${terminal.name}`);

  console.log(`Resuming ${tasksToRun.length} tasks...\n`);
  const results = await runPlan(tasksToRun, config, state, STATE_DIR, cwd, makeDeps(terminal));

  if (terminal) await terminal.cleanup();

  const completed = results.filter((r) => r.outcome === 'completed').length;
  const failed = results.filter((r) => r.outcome === 'failed').length;
  consoleLogger.done(completed, failed);
}

async function commandConfig(parsed: ParsedArgs): Promise<void> {
  if (parsed.configSet) {
    const { setConfigValue } = await import('./config/wizard.js');
    await setConfigValue(parsed.configSet);
  } else {
    const { runConfigWizard } = await import('./config/wizard.js');
    await runConfigWizard();
  }
}

async function commandStop(force: boolean): Promise<void> {
  const { sendSignal, readPid } = await import('./process.js');
  const pid = await readPid();
  if (!pid) {
    console.log('autopilot is not running.');
    return;
  }
  if (force) {
    await sendSignal('SIGKILL');
    console.log(`Force stopped process ${pid}.`);
  } else {
    await sendSignal('SIGTERM');
    console.log(`Graceful stop signal sent to process ${pid}.`);
  }
}

async function commandPause(): Promise<void> {
  const state = await loadState(STATE_DIR);
  if (!state) {
    console.log('No active run found.');
    return;
  }
  (state as unknown as Record<string, unknown>)['paused'] = true;
  await saveState(state, STATE_DIR);
  console.log('Paused. Run "claude-autopilot resume" to continue.');
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);

  switch (parsed.command) {
    case 'run':
      await commandRun(parsed);
      break;
    case 'status':
      await commandStatus();
      break;
    case 'resume':
      await commandResume();
      break;
    case 'config':
      await commandConfig(parsed);
      break;
    case 'init': {
      const { initMcpServer } = await import('./mcp/init.js');
      await initMcpServer();
      break;
    }
    case 'stop':
      await commandStop(parsed.force ?? false);
      break;
    case 'pause':
      await commandPause();
      break;
    case 'learn': {
      const { learnProject } = await import('./profiler.js');
      const profile = await learnProject(process.cwd());
      console.log('Project profile saved.');
      console.log(`  Language: ${profile.patterns.language}`);
      console.log(`  Branch strategy: ${profile.patterns.branchStrategy}`);
      console.log(`  Commit style: ${profile.patterns.commitStyle}`);
      console.log(`  Test framework: ${profile.patterns.testFramework}`);
      break;
    }
  }
}

const isTestEnv = process.env['VITEST'] === 'true' || process.env['NODE_ENV'] === 'test';
if (!isTestEnv) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
