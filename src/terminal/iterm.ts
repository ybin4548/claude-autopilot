import { execFile } from 'node:child_process';
import { writeFile, unlink, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { TerminalAdapter } from './adapter.js';

const exec = promisify(execFile);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ItermAdapter implements TerminalAdapter {
  name = 'iterm';
  private markerDir = join(tmpdir(), 'claude-autopilot-markers');
  private panes = new Map<string, { markerPath: string }>();

  private markerPath(paneId: string): string {
    return join(this.markerDir, `${paneId}.done`);
  }

  async openPane(taskId: string, cwd: string): Promise<string> {
    const paneId = `pane-${taskId}-${Date.now()}`;
    const marker = this.markerPath(paneId);
    this.panes.set(paneId, { markerPath: marker });

    await exec('mkdir', ['-p', this.markerDir]);

    const script = `
      tell application "iTerm2"
        activate
        tell current window
          create tab with default profile
          tell current session of current tab
            write text "cd ${cwd.replace(/'/g, "'\\''")}"
            set name to "${taskId}"
          end tell
        end tell
      end tell
    `;
    await exec('osascript', ['-e', script]);

    return paneId;
  }

  async runInPane(paneId: string, command: string): Promise<void> {
    const pane = this.panes.get(paneId);
    if (!pane) return;

    const wrappedCommand = `${command}; echo $? > ${pane.markerPath}`;

    const script = `
      tell application "iTerm2"
        tell current session of current tab of current window
          write text "${wrappedCommand.replace(/"/g, '\\"')}"
        end tell
      end tell
    `;
    await exec('osascript', ['-e', script]);
  }

  async waitForExit(paneId: string): Promise<number> {
    const pane = this.panes.get(paneId);
    if (!pane) return 1;

    while (true) {
      await sleep(2000);
      try {
        await stat(pane.markerPath);
        const { readFile } = await import('node:fs/promises');
        const code = (await readFile(pane.markerPath, 'utf-8')).trim();
        return parseInt(code, 10) || 0;
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
