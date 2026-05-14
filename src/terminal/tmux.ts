import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, unlink } from 'node:fs/promises';
import type { TerminalAdapter } from './adapter.js';

const exec = promisify(execFile);

const SESSION_NAME = 'claude-autopilot';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TmuxAdapter implements TerminalAdapter {
  name = 'tmux';
  private paneCount = 0;
  private markers = new Map<string, string>();

  async openPane(taskId: string, cwd: string): Promise<string> {
    if (this.paneCount === 0) {
      await exec('tmux', ['new-session', '-d', '-s', SESSION_NAME, '-c', cwd]);
      this.paneCount++;
      return `${SESSION_NAME}:0.0`;
    }

    await exec('tmux', ['split-window', '-t', SESSION_NAME, '-c', cwd]);
    await exec('tmux', ['select-layout', '-t', SESSION_NAME, 'tiled']);
    const { stdout } = await exec('tmux', ['display-message', '-t', SESSION_NAME, '-p', '#{pane_id}']);
    this.paneCount++;
    return stdout.trim();
  }

  async runInPane(paneId: string, command: string): Promise<void> {
    await exec('tmux', ['send-keys', '-t', paneId, command, 'Enter']);
  }

  async waitForExit(paneId: string): Promise<number> {
    const marker = this.markers.get(paneId);
    if (marker) {
      while (true) {
        await sleep(3000);
        try {
          const content = await readFile(marker, 'utf-8');
          return parseInt(content.trim(), 10) || 0;
        } catch { /* */ }
      }
    }

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
    const marker = this.markers.get(paneId);
    if (marker) {
      try { await unlink(marker); } catch { /* */ }
      this.markers.delete(paneId);
    }
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
    this.markers.clear();
  }
}
