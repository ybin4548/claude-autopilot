import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { TerminalAdapter } from './adapter.js';

const exec = promisify(execFile);

const SESSION_NAME = 'claude-autopilot';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TmuxAdapter implements TerminalAdapter {
  name = 'tmux';
  private paneCount = 0;

  async openPane(taskId: string, cwd: string): Promise<string> {
    if (this.paneCount === 0) {
      await exec('tmux', ['new-session', '-d', '-s', SESSION_NAME, '-c', cwd]);
      await exec('tmux', ['send-keys', '-t', SESSION_NAME, `printf '\\033]2;${taskId}\\033\\\\'`, 'Enter']);
      this.paneCount++;
      return `${SESSION_NAME}:0.0`;
    }

    await exec('tmux', ['split-window', '-t', SESSION_NAME, '-c', cwd]);
    await exec('tmux', ['select-layout', '-t', SESSION_NAME, 'tiled']);
    const { stdout } = await exec('tmux', ['display-message', '-t', SESSION_NAME, '-p', '#{pane_id}']);
    const paneId = stdout.trim();
    await exec('tmux', ['send-keys', '-t', paneId, `printf '\\033]2;${taskId}\\033\\\\'`, 'Enter']);
    this.paneCount++;
    return paneId;
  }

  async runInPane(paneId: string, command: string): Promise<void> {
    await exec('tmux', ['send-keys', '-t', paneId, command, 'Enter']);
  }

  async waitForExit(paneId: string): Promise<number> {
    while (true) {
      await sleep(2000);
      try {
        const { stdout } = await exec('tmux', [
          'display-message', '-t', paneId, '-p', '#{pane_dead}',
        ]);
        if (stdout.trim() === '1') {
          const { stdout: exitCode } = await exec('tmux', [
            'display-message', '-t', paneId, '-p', '#{pane_dead_status}',
          ]);
          return parseInt(exitCode.trim(), 10) || 0;
        }
      } catch {
        return 1;
      }
    }
  }

  async closePane(paneId: string): Promise<void> {
    try {
      await exec('tmux', ['kill-pane', '-t', paneId]);
      this.paneCount--;
    } catch { /* pane already closed */ }
  }

  async cleanup(): Promise<void> {
    try {
      await exec('tmux', ['kill-session', '-t', SESSION_NAME]);
    } catch { /* session doesn't exist */ }
    this.paneCount = 0;
  }
}
