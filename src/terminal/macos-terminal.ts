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

export class MacosTerminalAdapter implements TerminalAdapter {
  name = 'terminal-app';
  private markerDir = join(tmpdir(), 'claude-autopilot-markers');
  private panes = new Map<string, { markerPath: string; tabIndex: number }>();
  private tabCounter = 0;

  async openPane(taskId: string, cwd: string): Promise<string> {
    const paneId = `pane-${taskId}-${Date.now()}`;
    const markerPath = join(this.markerDir, `${paneId}.done`);

    await mkdir(this.markerDir, { recursive: true });

    // Create a new tab and get its tab index
    const script = `
      tell application "Terminal"
        activate
        do script "cd '${cwd.replace(/'/g, "'\\''")}' && clear && echo '🔄 [${taskId}] Starting...'"
        set tabIndex to index of front window
        return tabIndex
      end tell
    `;
    const { stdout } = await exec('osascript', ['-e', script]);
    const tabIndex = parseInt(stdout.trim(), 10) || 1;

    this.tabCounter++;
    this.panes.set(paneId, { markerPath, tabIndex });
    await sleep(500);

    return paneId;
  }

  async runInPane(paneId: string, command: string): Promise<void> {
    const pane = this.panes.get(paneId);
    if (!pane) return;

    const escaped = escapeForAppleScript(command);

    // Use the specific window index to send the command to the correct tab
    const script = `
      tell application "Terminal"
        do script "${escaped}" in window ${pane.tabIndex}
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
