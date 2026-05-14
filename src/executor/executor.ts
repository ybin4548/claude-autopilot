import { spawn } from 'node:child_process';
import type { Task, ExecutionResult, AutopilotConfig } from '../types.js';

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

export async function executeTask(
  task: Task,
  config: Pick<AutopilotConfig, 'git'>,
  cwd: string = process.cwd(),
): Promise<ExecutionResult> {
  const prompt = buildPrompt(task, cwd);
  return executeClaudeP(prompt, { cwd });
}

export { buildPrompt, isRateLimited };
