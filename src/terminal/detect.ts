import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { TerminalAdapter } from './adapter.js';
import type { AutopilotConfig } from '../types.js';

const exec = promisify(execFile);

async function commandExists(cmd: string): Promise<boolean> {
  try {
    await exec('which', [cmd]);
    return true;
  } catch {
    return false;
  }
}

async function isInsideTmux(): Promise<boolean> {
  return !!process.env['TMUX'];
}

async function isItermRunning(): Promise<boolean> {
  try {
    const { stdout } = await exec('osascript', [
      '-e', 'tell application "System Events" to (name of processes) contains "iTerm2"',
    ]);
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

export async function detectTerminal(): Promise<'tmux' | 'iterm' | 'terminal-app'> {
  if (await isInsideTmux()) return 'tmux';
  if (await isItermRunning()) return 'iterm';
  return 'terminal-app';
}

export async function createTerminalAdapter(
  config: Pick<AutopilotConfig, 'visual'>,
): Promise<TerminalAdapter> {
  const terminal = config.visual.terminal === 'auto'
    ? await detectTerminal()
    : config.visual.terminal;

  switch (terminal) {
    case 'tmux': {
      const { TmuxAdapter } = await import('./tmux.js');
      return new TmuxAdapter();
    }
    case 'iterm': {
      const { ItermAdapter } = await import('./iterm.js');
      return new ItermAdapter();
    }
    case 'terminal-app':
    default: {
      const { MacosTerminalAdapter } = await import('./macos-terminal.js');
      return new MacosTerminalAdapter();
    }
  }
}
