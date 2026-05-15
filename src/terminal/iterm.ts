import { execFile } from 'node:child_process';
import { unlink, mkdir, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { TerminalAdapter } from './adapter.js';

const exec = promisify(execFile);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeForAppleScript(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export class ItermAdapter implements TerminalAdapter {
  name = 'iterm';
  private markerDir = join(tmpdir(), 'claude-autopilot-markers');
  private panes = new Map<string, { markerPath: string }>();

  async openPane(taskId: string, cwd: string): Promise<string> {
    const paneId = `pane-${taskId}-${Date.now()}`;
    const markerPath = join(this.markerDir, `${paneId}.done`);
    this.panes.set(paneId, { markerPath });

    await mkdir(this.markerDir, { recursive: true });

    const script = `
      tell application "iTerm2"
        activate
        tell current window
          create tab with default profile
          tell current session of current tab
            write text "cd '${cwd.replace(/'/g, "'\\''")}' && clear && echo '[${taskId}] Starting...'"
          end tell
        end tell
      end tell
    `;
    await exec('osascript', ['-e', script]);
    await sleep(500);

    return paneId;
  }

  async runInPane(paneId: string, command: string): Promise<void> {
    const escaped = escapeForAppleScript(command);
    const script = `
      tell application "iTerm2"
        tell current session of current tab of current window
          write text "${escaped}"
        end tell
      end tell
    `;
    await exec('osascript', ['-e', script]);
  }

  async waitForExit(paneId: string): Promise<number> {
    const pane = this.panes.get(paneId);
    if (!pane) return 1;

    while (true) {
      await sleep(3000);
      try {
        const content = await readFile(pane.markerPath, 'utf-8');
        return parseInt(content.trim(), 10) || 0;
      } catch {
        // marker not yet created
      }
    }
  }

  async closePane(paneId: string): Promise<void> {
    const pane = this.panes.get(paneId);
    if (!pane) return;
    try { await unlink(pane.markerPath); } catch { /* */ }
    this.panes.delete(paneId);
  }

  async cleanup(): Promise<void> {
    for (const [id] of this.panes) {
      await this.closePane(id);
    }
  }
}
