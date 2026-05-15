import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const AUTOPILOT_CONFIG_DIR = join(homedir(), '.claude-autopilot');
const AUTOPILOT_CONFIG_PATH = join(AUTOPILOT_CONFIG_DIR, 'config.json');
const CLAUDE_JSON_PATH = join(homedir(), '.claude.json');

interface ClaudeJson {
  mcpServers?: Record<string, { type: string; command: string; args: string[]; env: Record<string, string> }>;
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
  const hasConfig = await fileExists(AUTOPILOT_CONFIG_PATH);
  if (!hasConfig) {
    const { runConfigWizard } = await import('../config/wizard.js');
    await runConfigWizard();
  } else {
    console.log('Config already exists at ~/.claude-autopilot/config.json\n');
  }

  let claudeJson: ClaudeJson = {};
  try {
    const raw = await readFile(CLAUDE_JSON_PATH, 'utf-8');
    claudeJson = JSON.parse(raw);
  } catch {
    // file doesn't exist
  }

  if (!claudeJson.mcpServers) {
    claudeJson.mcpServers = {};
  }

  const binPath = await getBinPath();

  if (claudeJson.mcpServers['claude-autopilot']) {
    console.log('MCP server already registered.\n');
  } else {
    claudeJson.mcpServers['claude-autopilot'] = {
      type: 'stdio',
      command: binPath,
      args: [],
      env: {},
    };

    await writeFile(CLAUDE_JSON_PATH, JSON.stringify(claudeJson, null, 2), 'utf-8');

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
