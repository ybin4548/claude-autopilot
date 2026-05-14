export interface Logger {
  planReview(pass: number, warn: number, fail: number, score: number): void;
  groupStart(groupIndex: number, totalGroups: number, taskCount: number): void;
  taskExecuting(taskId: string, attempt: number, maxRetries: number): void;
  taskExecuted(taskId: string, success: boolean): void;
  taskValidating(taskId: string, steps: string[]): void;
  taskValidated(taskId: string, passed: boolean): void;
  taskPublishing(taskId: string, branch: string): void;
  taskPublished(taskId: string, prNumber: number, merged: boolean): void;
  taskFailed(taskId: string, reason: string): void;
  taskRateLimited(taskId: string): void;
  rateLimitRecovered(): void;
  done(completed: number, failed: number): void;
}

export const consoleLogger: Logger = {
  planReview(pass, warn, fail, score) {
    console.log(`\n📋 Plan Review\n`);
    console.log(`  ✅ Pass: ${pass}`);
    if (warn > 0) console.log(`  ⚠️  Warn: ${warn}`);
    if (fail > 0) console.log(`  ❌ Fail: ${fail}`);
    console.log(`  Score: ${score}%\n`);
  },

  groupStart(groupIndex, totalGroups, taskCount) {
    const parallel = taskCount > 1 ? '(parallel)' : '';
    console.log(`\n▶️  Group ${groupIndex + 1}/${totalGroups} — ${taskCount} task${taskCount > 1 ? 's' : ''} ${parallel}`);
  },

  taskExecuting(taskId, attempt, maxRetries) {
    console.log(`  🔄 [${taskId}] Executing claude -p... (attempt ${attempt}/${maxRetries})`);
  },

  taskExecuted(taskId, success) {
    if (success) {
      console.log(`  ✅ [${taskId}] Execution complete`);
    } else {
      console.log(`  ⚠️  [${taskId}] Execution failed`);
    }
  },

  taskValidating(taskId, steps) {
    console.log(`  🔍 [${taskId}] Validating... (${steps.join(', ')})`);
  },

  taskValidated(taskId, passed) {
    if (passed) {
      console.log(`  ✅ [${taskId}] Validation passed`);
    } else {
      console.log(`  ❌ [${taskId}] Validation failed`);
    }
  },

  taskPublishing(taskId, branch) {
    console.log(`  📦 [${taskId}] Publishing... (branch: ${branch})`);
  },

  taskPublished(taskId, prNumber, merged) {
    if (merged) {
      console.log(`  ✅ [${taskId}] PR #${prNumber} created — auto-merged`);
    } else {
      console.log(`  👀 [${taskId}] PR #${prNumber} created — awaiting review`);
    }
  },

  taskFailed(taskId, reason) {
    console.log(`  ❌ [${taskId}] Failed: ${reason}`);
  },

  taskRateLimited(taskId) {
    console.log(`  ⏸️  [${taskId}] Rate limited — waiting for recovery...`);
  },

  rateLimitRecovered() {
    console.log(`  ▶️  Rate limit recovered — resuming`);
  },

  done(completed, failed) {
    console.log(`\n🎉 Done! ${completed} completed, ${failed} failed.\n`);
  },
};
