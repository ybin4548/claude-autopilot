import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface Feedback {
  type: 'plan-change' | 'suggestion' | 'blocker';
  taskId: string;
  message: string;
}

const TAG_RE = /\[(PLAN_CHANGE|SUGGESTION|BLOCKER)\]\s*(.+?)(?=\[(?:PLAN_CHANGE|SUGGESTION|BLOCKER)\]|$)/gs;

export function parseFeedback(taskId: string, output: string): Feedback[] {
  const feedbacks: Feedback[] = [];
  let match;

  while ((match = TAG_RE.exec(output)) !== null) {
    const tag = match[1];
    const message = match[2].trim();

    let type: Feedback['type'];
    if (tag === 'PLAN_CHANGE') type = 'plan-change';
    else if (tag === 'SUGGESTION') type = 'suggestion';
    else type = 'blocker';

    feedbacks.push({ type, taskId, message });
  }

  TAG_RE.lastIndex = 0;
  return feedbacks;
}

export async function recordFeedback(feedback: Feedback, cwd: string): Promise<void> {
  const timestamp = new Date().toISOString();

  if (feedback.type === 'plan-change') {
    const path = join(cwd, 'plan-changes.md');
    const entry = `\n## ${timestamp} — ${feedback.taskId}\n- ${feedback.message}\n`;
    await appendFile(path, entry, 'utf-8');
  }

  if (feedback.type === 'suggestion') {
    const path = join(cwd, 'suggestions.md');
    const entry = `\n## ${timestamp} — ${feedback.taskId}\n- ${feedback.message}\n`;
    await appendFile(path, entry, 'utf-8');
  }
}

export async function notify(
  message: string,
  channel: 'system' | 'slack' | 'discord' | 'none',
  webhookUrl?: string,
): Promise<void> {
  if (channel === 'none') return;

  if (channel === 'system') {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const exec = promisify(execFile);
    try {
      await exec('osascript', ['-e', `display notification "${message.replace(/"/g, '\\"')}" with title "claude-autopilot"`]);
    } catch { /* osascript may fail on non-macOS */ }
    return;
  }

  if ((channel === 'slack' || channel === 'discord') && webhookUrl) {
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(channel === 'slack' ? { text: message } : { content: message }),
      });
    } catch { /* webhook may fail */ }
  }
}
