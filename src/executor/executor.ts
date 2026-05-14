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

function buildPrompt(task: Task, cwd: string): string {
  const lines = [
    `You are implementing a task in the project at: ${cwd}`,
    '',
    `Task ID: ${task.id}`,
    `Description: ${task.description}`,
  ];

  if (task.detail) {
    lines.push(`Detail: ${task.detail}`);
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
    const args = ['-p', '--output-format', 'text'];

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

export async function executeTaskVisual(
  task: Task,
  cwd: string,
  terminal: TerminalAdapter,
): Promise<ExecutionResult> {
  await mkdir(PROMPT_DIR, { recursive: true });

  const promptPath = join(PROMPT_DIR, `${task.id}-prompt.txt`);
  const markerPath = join(PROMPT_DIR, `${task.id}-marker.done`);

  const prompt = buildPrompt(task, cwd);
  await writeFile(promptPath, prompt, 'utf-8');

  const paneId = await terminal.openPane(task.id, cwd);

  // Run claude in interactive mode: pipe the prompt, then user can see and interact
  // When claude exits, write exit code to marker file
  const command = `cat '${promptPath}' | claude; echo $? > '${markerPath}'`;
  await terminal.runInPane(paneId, command);

  // Poll for completion via marker file
  while (true) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const content = await readFile(markerPath, 'utf-8');
      const exitCode = parseInt(content.trim(), 10) || 0;

      try { await unlink(promptPath); } catch { /* */ }
      try { await unlink(markerPath); } catch { /* */ }

      return {
        stdout: '',
        stderr: '',
        exitCode,
        rateLimited: false,
      };
    } catch {
      // marker not yet created — still running
    }
  }
}

export async function executeTask(
  task: Task,
  config: Pick<AutopilotConfig, 'git'>,
  cwd: string = process.cwd(),
  terminal?: TerminalAdapter,
): Promise<ExecutionResult> {
  if (terminal) {
    return executeTaskVisual(task, cwd, terminal);
  }
  const prompt = buildPrompt(task, cwd);
  return executeClaudeP(prompt, { cwd });
}

export { buildPrompt, isRateLimited };
