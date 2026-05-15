import { writeFile, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const PID_PATH = join(homedir(), '.claude-autopilot', 'pid');

export async function writePid(): Promise<void> {
  await writeFile(PID_PATH, String(process.pid), 'utf-8');
}

export async function readPid(): Promise<number | null> {
  try {
    const raw = await readFile(PID_PATH, 'utf-8');
    return parseInt(raw.trim(), 10) || null;
  } catch {
    return null;
  }
}

export async function removePid(): Promise<void> {
  try { await unlink(PID_PATH); } catch { /* */ }
}

export async function sendSignal(signal: NodeJS.Signals): Promise<boolean> {
  const pid = await readPid();
  if (!pid) {
    console.log('autopilot is not running.');
    return false;
  }

  try {
    process.kill(pid, signal);
    return true;
  } catch {
    console.log('autopilot process not found. Cleaning up PID file.');
    await removePid();
    return false;
  }
}

let sigintCount = 0;

export function setupSignalHandlers(onGraceful: () => void, onForce: () => void): void {
  process.on('SIGINT', () => {
    sigintCount++;
    if (sigintCount === 1) {
      console.log('\nGraceful shutdown... (press Ctrl+C again to force)');
      onGraceful();
    } else {
      console.log('\nForce shutdown.');
      onForce();
    }
  });

  process.on('SIGTERM', () => {
    onGraceful();
  });
}
