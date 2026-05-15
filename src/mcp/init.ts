import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const AUTOPILOT_CONFIG_DIR = join(homedir(), '.claude-autopilot');
const AUTOPILOT_CONFIG_PATH = join(AUTOPILOT_CONFIG_DIR, 'config.json');
const CLAUDE_CONFIG_DIR = join(homedir(), '.claude');
const CLAUDE_SETTINGS_PATH = join(CLAUDE_CONFIG_DIR, 'settings.json');

interface ClaudeSettings {
  mcpServers?: Record<string, { command: string; args?: string[] }>;
  [key: string]: unknown;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function getBinPath(): Promise<string> {
  try {
    const { stdout } = await exec('which', ['claude-autopilot-mcp']);
    return stdout.trim();
  } catch {
    return 'claude-autopilot-mcp';
  }
}

export async function initMcpServer(): Promise<void> {
  // Step 1: Config wizard if not configured
  const hasConfig = await fileExists(AUTOPILOT_CONFIG_PATH);
  if (!hasConfig) {
    const { runConfigWizard } = await import('../config/wizard.js');
    await runConfigWizard();
  } else {
    console.log('Config already exists at ~/.claude-autopilot/config.json\n');
  }

  // Step 2: Register MCP server
  await mkdir(CLAUDE_CONFIG_DIR, { recursive: true });

  let settings: ClaudeSettings = {};
  try {
    const raw = await readFile(CLAUDE_SETTINGS_PATH, 'utf-8');
    settings = JSON.parse(raw);
  } catch {
    // file doesn't exist, start fresh
  }

  if (!settings.mcpServers) {
    settings.mcpServers = {};
  }

  const binPath = await getBinPath();

  if (settings.mcpServers['claude-autopilot']) {
    console.log('MCP server already registered.\n');
  } else {
    settings.mcpServers['claude-autopilot'] = {
      command: binPath,
    };

    await writeFile(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');

    console.log('MCP server registered.');
    console.log(`  Binary: ${binPath}\n`);
  }

  console.log('Setup complete! Restart Claude Code to activate.\n');
  console.log('Available tools in Claude:');
  console.log('  - autopilot_run: Run a plan file');
  console.log('  - autopilot_status: Check progress');
  console.log('  - autopilot_resume: Resume interrupted run');
  console.log('  - autopilot_config: Set config values\n');
  console.log('Or use the CLI directly:');
  console.log('  claude-autopilot run plan.md');
}
