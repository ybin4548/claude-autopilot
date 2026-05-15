#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { spawn } from 'node:child_process';

function runCli(args: string[], cwd: string): Promise<{ stdout: string; exitCode: number }> {
  return new Promise((resolve) => {
    const child = spawn('claude-autopilot', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.stderr.on('data', (c: Buffer) => chunks.push(c));
    child.on('close', (code) => {
      resolve({ stdout: Buffer.concat(chunks).toString('utf-8'), exitCode: code ?? 1 });
    });
  });
}

const server = new McpServer({
  name: 'claude-autopilot',
  version: '0.1.0',
});

server.tool(
  'autopilot_run',
  'Run a plan file or GitHub Issues to auto-implement tasks',
  {
    source: z.string().describe('Path to plan.md file or "github:owner/repo"'),
    cwd: z.string().describe('Working directory of the target project'),
    noVisual: z.boolean().optional().describe('Disable visual terminal mode'),
  },
  async ({ source, cwd, noVisual }) => {
    const args = ['run'];

    if (source.startsWith('github:')) {
      args.push('--github', source.replace('github:', ''));
    } else {
      args.push(source);
    }

    if (noVisual) args.push('--no-visual');

    const result = await runCli(args, cwd);
    return {
      content: [{ type: 'text' as const, text: result.stdout || `Exit code: ${result.exitCode}` }],
    };
  },
);

server.tool(
  'autopilot_status',
  'Check the current progress of a running autopilot plan',
  {
    cwd: z.string().optional().describe('Working directory (optional)'),
  },
  async ({ cwd }) => {
    const result = await runCli(['status'], cwd ?? process.cwd());
    return {
      content: [{ type: 'text' as const, text: result.stdout || 'No active run found.' }],
    };
  },
);

server.tool(
  'autopilot_resume',
  'Resume an interrupted autopilot run from saved state',
  {
    cwd: z.string().describe('Working directory of the target project'),
  },
  async ({ cwd }) => {
    const result = await runCli(['resume'], cwd);
    return {
      content: [{ type: 'text' as const, text: result.stdout || `Exit code: ${result.exitCode}` }],
    };
  },
);

server.tool(
  'autopilot_config',
  'Set a specific autopilot configuration value',
  {
    key: z.string().describe('Config key (e.g., "merge.method", "validation.typecheck")'),
    value: z.string().describe('Config value (e.g., "rebase", "false")'),
  },
  async ({ key, value }) => {
    const result = await runCli(['config', '--set', `${key}=${value}`], process.cwd());
    return {
      content: [{ type: 'text' as const, text: result.stdout || `Exit code: ${result.exitCode}` }],
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('MCP server error:', err);
  process.exit(1);
});
