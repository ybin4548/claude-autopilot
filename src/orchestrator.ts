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
import { updateTaskState } from './state/state.js';
import { waitForRateLimit, type HealthCheckFn } from './rate-limiter/limiter.js';
import type { Logger } from './logger.js';

export interface OrchestratorDeps {
  publisher: PublisherDeps;
  commandRunner: CommandRunner;
  ghRunner: GhRunner;
  healthCheck: HealthCheckFn;
  logger: Logger;
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
  const log = deps.logger;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    await updateTaskState(stateDir, task.id, {
      status: 'in-progress',
      attempts: attempt,
    });

    log.taskExecuting(task.id, attempt, maxRetries);
    const execResult = await executeTask(task, config, cwd);

    if (execResult.rateLimited) {
      log.taskRateLimited(task.id);
      await waitForRateLimit(state, config, stateDir, deps.healthCheck);
      log.rateLimitRecovered();
      continue;
    }

    if (execResult.exitCode !== 0) {
      log.taskExecuted(task.id, false);
      if (attempt === maxRetries) {
        const error = execResult.stderr.slice(0, 200) || 'Execution failed';
        log.taskFailed(task.id, error);
        await updateTaskState(stateDir, task.id, { status: 'failed' });
        return { outcome: 'failed', error };
      }
      continue;
    }

    log.taskExecuted(task.id, true);

    const activeSteps: string[] = ['diff'];
    if (config.validation.typecheck) activeSteps.push('typecheck');
    if (config.validation.test) activeSteps.push('test');
    if (config.validation.build) activeSteps.push('build');
    log.taskValidating(task.id, activeSteps);

    const validation = await validateCode(config, cwd, deps.commandRunner);
    log.taskValidated(task.id, validation.passed);

    if (!validation.passed) {
      if (attempt === maxRetries) {
        const failedStep = validation.steps.find((s) => !s.passed);
        const error = failedStep ? `${failedStep.step}: ${failedStep.output.slice(0, 200)}` : 'Validation failed';
        log.taskFailed(task.id, error);
        await updateTaskState(stateDir, task.id, { status: 'failed' });
        return { outcome: 'failed', error };
      }
      continue;
    }

    const branch = `${config.git.branchPrefix}${task.id}`;
    log.taskPublishing(task.id, branch);
    const publishResult = await publish(task, config, cwd, deps.publisher);
    log.taskPublished(task.id, publishResult.prNumber, publishResult.merged);

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
  const log = deps.logger;

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    log.groupStart(i, groups.length, group.length);

    const groupResults = await Promise.all(
      group.map(async (task) => {
        try {
          return await runSingleTask(task, config, state, stateDir, cwd, deps);
        } catch (err) {
          log.taskFailed(task.id, String(err));
          await updateTaskState(stateDir, task.id, { status: 'failed' });
          return { outcome: 'failed' as const, error: String(err) };
        }
      }),
    );
    results.push(...groupResults);
  }

  return results;
}
