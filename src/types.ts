export type TaskMode = 'auto' | 'review';

export type TaskStatus =
  | 'pending'
  | 'in-progress'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'skipped';

export interface Task {
  id: string;
  description: string;
  detail: string;
  mode: TaskMode;
  status: TaskStatus;
  dependencies: string[];
  branch?: string;
  prNumber?: number;
  attempts?: number;
  completedAt?: string;
}

export type ValidationVerdict = 'pass' | 'warn' | 'fail';

export interface TaskValidation {
  taskId: string;
  verdict: ValidationVerdict;
  reasons: string[];
}

export interface PlanValidationReport {
  validations: TaskValidation[];
  passCount: number;
  warnCount: number;
  failCount: number;
  score: number;
}

export type PlanSource = 'markdown' | 'github';

export interface AutopilotConfig {
  defaultMode: TaskMode;
  codeReview: {
    strategy: 'none' | 'ai' | 'human';
    maxRevisions: number;
  };
  merge: {
    strategy: 'auto' | 'manual';
    method: 'squash' | 'merge' | 'rebase';
  };
  git: {
    baseBranch: string;
    branchPrefix: string;
  };
  parallel: {
    maxConcurrent: number;
    useContextSync: boolean;
  };
  validation: {
    typecheck: boolean;
    test: boolean;
    build: boolean;
    maxRetries: number;
  };
  rateLimit: {
    healthCheckInterval: number;
    autoResume: boolean;
  };
  system: {
    preventSleep: boolean;
  };
  source: {
    type: PlanSource;
    githubLabel: string;
  };
  visual: {
    terminal: 'auto' | 'tmux' | 'terminal-app' | 'iterm';
  };
}

export interface AutopilotState {
  planSource: string;
  startedAt: string;
  tasks: TaskState[];
  rateLimited: boolean;
  lastHealthCheck: string | null;
}

export interface TaskState {
  id: string;
  status: TaskStatus;
  branch?: string;
  prNumber?: number;
  attempts?: number;
  completedAt?: string;
}

export type ParallelGroup = Task[];

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  rateLimited: boolean;
}

export type ValidationStep = 'diff' | 'typecheck' | 'test' | 'build';

export interface ValidationStepResult {
  step: ValidationStep;
  passed: boolean;
  output: string;
}

export interface CodeValidationResult {
  passed: boolean;
  steps: ValidationStepResult[];
}

export interface PublishResult {
  branch: string;
  prNumber: number;
  prUrl: string;
  merged: boolean;
}

export type PRReviewState = 'APPROVED' | 'CHANGES_REQUESTED' | 'PENDING';

export type TaskResult =
  | { outcome: 'completed'; prNumber: number; prUrl: string; merged: boolean }
  | { outcome: 'failed'; error: string }
  | { outcome: 'rate-limited' };
