import { spawn } from 'node:child_process';
import { writeFile, unlink, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Task, ExecutionResult, AutopilotConfig } from '../types.js';
import type { TerminalAdapter } from '../terminal/adapter.js';

const RATE_LIMIT_PATTERNS = [
  /rate limit/i,
  /too many requests/i,
  /429/,
  /quota exceeded/i,
];

function buildPrompt(task: Task, cwd: string, changedFiles?: string[]): string {
  const lines = [
    `You are implementing a task in the project at: ${cwd}`,
    '',
    `Task ID: ${task.id}`,
    `Description: ${task.description}`,
  ];

  if (task.detail) {
    lines.push(`Detail: ${task.detail}`);
  }

  if (changedFiles && changedFiles.length > 0) {
    lines.push(
      '',
      'Context — files changed by previous tasks:',
      ...changedFiles.map((f) => `  - ${f}`),
    );
  }

  lines.push(
    '',
    'Instructions:',
    '- Implement only what is described above',
    '- Do not modify unrelated files',
    '- Ensure the code compiles without errors',
  );

  return lines.join('\n');
}

function isRateLimited(stderr: string): boolean {
  return RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(stderr));
}

export function executeClaudeP(
  prompt: string,
  options: { cwd: string; allowedTools?: string[] } = { cwd: process.cwd() },
): Promise<ExecutionResult> {
  return new Promise((resolve) => {
    const args = ['-p', '--output-format', 'text', '--dangerously-skip-permissions'];

    if (options.allowedTools) {
      for (const tool of options.allowedTools) {
        args.push('--allowedTools', tool);
      }
    }

    const child = spawn('claude', args, {
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    child.on('close', (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
      const stderr = Buffer.concat(stderrChunks).toString('utf-8');

      resolve({
        stdout,
        stderr,
        exitCode: code ?? 1,
        rateLimited: isRateLimited(stderr),
      });
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

const PROMPT_DIR = join(tmpdir(), 'claude-autopilot-prompts');

const openPanes = new Map<string, string>();

export async function executeTaskVisual(
  task: Task,
  cwd: string,
  terminal: TerminalAdapter,
  changedFiles?: string[],
): Promise<ExecutionResult> {
  await mkdir(PROMPT_DIR, { recursive: true });

  const promptPath = join(PROMPT_DIR, `${task.id}-prompt.txt`);
  const prompt = buildPrompt(task, cwd, changedFiles);
  await writeFile(promptPath, prompt, 'utf-8');

  let paneId = openPanes.get(task.id);
  if (!paneId) {
    paneId = await terminal.openPane(task.id, cwd);
    openPanes.set(task.id, paneId);
  }

  const command = `claude -p --dangerously-skip-permissions < '${promptPath}'`;
  await terminal.runInPane(paneId, command);

  const exitCode = await terminal.waitForExit(paneId);

  try { await unlink(promptPath); } catch { /* */ }

  return {
    stdout: '',
    stderr: '',
    exitCode,
    rateLimited: false,
  };
}

export function cleanupVisualPane(taskId: string, terminal: TerminalAdapter): Promise<void> {
  const paneId = openPanes.get(taskId);
  if (paneId) {
    openPanes.delete(taskId);
    return terminal.closePane(paneId);
  }
  return Promise.resolve();
}

export async function executeTask(
  task: Task,
  config: Pick<AutopilotConfig, 'git'>,
  cwd: string = process.cwd(),
  terminal?: TerminalAdapter,
  changedFiles?: string[],
): Promise<ExecutionResult> {
  if (terminal) {
    return executeTaskVisual(task, cwd, terminal, changedFiles);
  }
  const prompt = buildPrompt(task, cwd, changedFiles);
  return executeClaudeP(prompt, { cwd });
}

export { buildPrompt, isRateLimited };
