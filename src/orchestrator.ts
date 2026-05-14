import type {
  Task,
  AutopilotConfig,
  AutopilotState,
  TaskResult,
  ParallelGroup,
} from './types.js';
import { buildParallelGroups } from './queue/queue.js';
import { executeTask } from './executor/executor.js';
import { validateCode, type CommandRunner } from './validator/validator.js';
import { publish, type PublisherDeps } from './publisher/publisher.js';
import { pollPRStatus, type GhRunner } from './reviewer/reviewer.js';
import { updateTaskState, saveState } from './state/state.js';
import { waitForRateLimit, type HealthCheckFn } from './rate-limiter/limiter.js';

export interface OrchestratorDeps {
  publisher: PublisherDeps;
  commandRunner: CommandRunner;
  ghRunner: GhRunner;
  healthCheck: HealthCheckFn;
}

async function runSingleTask(
  task: Task,
  config: AutopilotConfig,
  state: AutopilotState,
  stateDir: string,
  cwd: string,
  deps: OrchestratorDeps,
): Promise<TaskResult> {
  const maxRetries = config.validation.maxRetries;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    await updateTaskState(stateDir, task.id, {
      status: 'in-progress',
      attempts: attempt,
    });

    const execResult = await executeTask(task, config, cwd);

    if (execResult.rateLimited) {
      await waitForRateLimit(state, config, stateDir, deps.healthCheck);
      continue;
    }

    if (execResult.exitCode !== 0) {
      if (attempt === maxRetries) {
        await updateTaskState(stateDir, task.id, { status: 'failed' });
        return { outcome: 'failed', error: execResult.stderr };
      }
      continue;
    }

    const validation = await validateCode(config, cwd, deps.commandRunner);

    if (!validation.passed) {
      if (attempt === maxRetries) {
        await updateTaskState(stateDir, task.id, { status: 'failed' });
        const failedStep = validation.steps.find((s) => !s.passed);
        return { outcome: 'failed', error: failedStep?.output ?? 'Validation failed' };
      }
      continue;
    }

    const publishResult = await publish(task, config, cwd, deps.publisher);

    if (!publishResult.merged && task.mode === 'review') {
      const reviewState = await pollPRStatus(
        publishResult.prNumber,
        cwd,
        deps.ghRunner,
        30_000,
      );

      if (reviewState === 'APPROVED') {
        await deps.publisher.gh(
          ['pr', 'merge', String(publishResult.prNumber), `--${config.merge.method}`, '--delete-branch'],
          cwd,
        );
      }
    }

    await updateTaskState(stateDir, task.id, {
      status: 'completed',
      branch: publishResult.branch,
      prNumber: publishResult.prNumber,
      completedAt: new Date().toISOString(),
    });

    return {
      outcome: 'completed',
      prNumber: publishResult.prNumber,
      prUrl: publishResult.prUrl,
      merged: publishResult.merged || task.mode === 'review',
    };
  }

  await updateTaskState(stateDir, task.id, { status: 'failed' });
  return { outcome: 'failed', error: 'Max retries exceeded' };
}

export async function runPlan(
  tasks: Task[],
  config: AutopilotConfig,
  state: AutopilotState,
  stateDir: string,
  cwd: string,
  deps: OrchestratorDeps,
): Promise<TaskResult[]> {
  const runnableTasks = tasks.filter((t) => t.status === 'pending');
  const groups: ParallelGroup[] = buildParallelGroups(runnableTasks);
  const results: TaskResult[] = [];

  for (const group of groups) {
    const groupResults = await Promise.all(
      group.map((task) =>
        runSingleTask(task, config, state, stateDir, cwd, deps),
      ),
    );
    results.push(...groupResults);
  }

  return results;
}
