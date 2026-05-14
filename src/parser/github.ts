import type { Task, TaskMode } from '../types.js';

export type GhRunner = (
  args: string[],
  cwd: string,
) => Promise<{ stdout: string; exitCode: number }>;

interface GhIssue {
  number: number;
  title: string;
  body: string;
  labels: Array<{ name: string }>;
}

function extractMode(labels: Array<{ name: string }>, defaultMode: TaskMode): TaskMode {
  if (labels.some((l) => l.name === 'review')) return 'review';
  if (labels.some((l) => l.name === 'auto')) return 'auto';
  return defaultMode;
}

function extractDependencies(body: string): string[] {
  const match = body.match(/depends:\s*(.+)/i);
  if (!match) return [];
  return match[1].split(',').map((d) => d.trim()).filter(Boolean);
}

function issueToTask(issue: GhIssue, defaultMode: TaskMode): Task {
  const firstLine = (issue.body ?? '').split('\n').find((l) => l.trim()) ?? '';
  const remaining = (issue.body ?? '').split('\n').slice(1).join('\n').trim();

  return {
    id: `issue-${issue.number}`,
    description: issue.title,
    detail: firstLine || '',
    mode: extractMode(issue.labels, defaultMode),
    status: 'pending',
    dependencies: extractDependencies(issue.body ?? ''),
  };
}

export async function parseGithubIssues(
  repo: string,
  label: string,
  defaultMode: TaskMode,
  cwd: string,
  gh: GhRunner,
): Promise<Task[]> {
  const result = await gh(
    [
      'issue', 'list',
      '--repo', repo,
      '--label', label,
      '--state', 'open',
      '--json', 'number,title,body,labels',
    ],
    cwd,
  );

  if (result.exitCode !== 0) {
    throw new Error(`Failed to fetch issues from ${repo}`);
  }

  const issues: GhIssue[] = JSON.parse(result.stdout);
  return issues.map((issue) => issueToTask(issue, defaultMode));
}
