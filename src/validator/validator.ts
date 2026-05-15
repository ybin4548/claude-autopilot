import { spawn } from 'node:child_process';
import type {
  AutopilotConfig,
  ValidationStep,
  ValidationStepResult,
  CodeValidationResult,
} from '../types.js';

export type CommandRunner = (
  command: string,
  args: string[],
  cwd: string,
) => Promise<{ output: string; exitCode: number }>;

export const defaultCommandRunner: CommandRunner = (command, args, cwd) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });

    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => chunks.push(chunk));

    child.on('close', (code) => {
      resolve({
        output: Buffer.concat(chunks).toString('utf-8'),
        exitCode: code ?? 1,
      });
    });
  });

async function checkDiff(
  cwd: string,
  run: CommandRunner,
): Promise<ValidationStepResult> {
  const result = await run('git', ['diff', '--name-only'], cwd);
  const hasChanges = result.output.trim().length > 0;
  return {
    step: 'diff',
    passed: hasChanges,
    output: hasChanges ? result.output : 'No changes detected',
  };
}

async function runStep(
  step: ValidationStep,
  command: string,
  args: string[],
  cwd: string,
  run: CommandRunner,
): Promise<ValidationStepResult> {
  const result = await run(command, args, cwd);
  return { step, passed: result.exitCode === 0, output: result.output };
}

export async function validateCode(
  config: Pick<AutopilotConfig, 'validation'>,
  cwd: string = process.cwd(),
  run: CommandRunner = defaultCommandRunner,
): Promise<CodeValidationResult> {
  const steps: ValidationStepResult[] = [];

  const diffResult = await checkDiff(cwd, run);
  steps.push(diffResult);
  if (!diffResult.passed) {
    return { passed: false, steps };
  }

  if (config.validation.typecheck) {
    const result = await runStep('typecheck', 'npx', ['tsc', '--noEmit'], cwd, run);
    steps.push(result);
    if (!result.passed) return { passed: false, steps };
  }

  if (config.validation.test) {
    const result = await runStep('test', 'npx', ['vitest', 'run'], cwd, run);
    steps.push(result);
    if (!result.passed) return { passed: false, steps };
  }

  if (config.validation.build) {
    const result = await runStep('build', 'npm', ['run', 'build'], cwd, run);
    steps.push(result);
    if (!result.passed) return { passed: false, steps };
  }

  return { passed: true, steps };
}
