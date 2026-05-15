#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseMarkdownString } from '../parser/markdown.js';
import { validatePlan } from '../validator/plan-validator.js';
import { buildParallelGroups, applyMaxConcurrent } from '../queue/queue.js';
import { loadConfig } from '../config/loader.js';
import type { Task } from '../types.js';

// --- State for agent mode ---
let agentTasks: Task[] = [];
let agentGroups: Task[][] = [];
let agentGroupIndex = 0;
let agentTaskIndex = 0;
let completedIds = new Set<string>();
let changedFiles: string[] = [];

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
  version: '1.0.2',
});

// --- CLI mode tools (existing) ---

server.tool(
  'autopilot_run',
  'Run a plan file via CLI mode (spawns terminal tabs with claude -p). Best for long-running plans or when laptop may sleep.',
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

// --- Agent mode tools (new) ---

server.tool(
  'autopilot_plan',
  'Parse and validate a plan file. Returns task list with execution order. Use this first, then call autopilot_next repeatedly to get tasks to implement.',
  {
    planFile: z.string().describe('Path to plan.md file'),
    cwd: z.string().describe('Working directory of the target project'),
  },
  async ({ planFile, cwd }) => {
    try {
      const content = await readFile(resolve(cwd, planFile), 'utf-8');
      const tasks = parseMarkdownString(content);
      const report = validatePlan(tasks);

      const config = await loadConfig(cwd);
      const runnableTasks = tasks.filter((t) => {
        const v = report.validations.find((val) => val.taskId === t.id);
        return v?.verdict !== 'fail';
      });

      const rawGroups = buildParallelGroups(runnableTasks);
      const groups = applyMaxConcurrent(rawGroups, config.parallel.maxConcurrent);

      // Reset agent state
      agentTasks = runnableTasks;
      agentGroups = groups;
      agentGroupIndex = 0;
      agentTaskIndex = 0;
      completedIds = new Set();
      changedFiles = [];

      const totalTasks = runnableTasks.length;
      const groupSummary = groups.map((g, i) =>
        `  Group ${i + 1}: ${g.map((t) => t.id).join(', ')}${g.length > 1 ? ' (parallel)' : ''}`
      ).join('\n');

      const validationSummary = [
        `PASS: ${report.passCount}`,
        report.warnCount > 0 ? `WARN: ${report.warnCount}` : '',
        report.failCount > 0 ? `FAIL: ${report.failCount}` : '',
        `Score: ${report.score}%`,
      ].filter(Boolean).join(', ');

      let text = `Plan loaded: ${totalTasks} tasks in ${groups.length} groups\n`;
      text += `Validation: ${validationSummary}\n\n`;
      text += `Execution order:\n${groupSummary}\n\n`;
      text += `Call autopilot_next to get the first task to implement.`;

      return { content: [{ type: 'text' as const, text }] };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Error: ${err}` }] };
    }
  },
);

server.tool(
  'autopilot_next',
  'Get the next task to implement. Returns the task prompt with description, detail, and context from previous tasks. Implement the task yourself, then call autopilot_complete.',
  {
    cwd: z.string().describe('Working directory of the target project'),
  },
  async ({ cwd }) => {
    if (agentGroups.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No plan loaded. Call autopilot_plan first.' }] };
    }

    if (agentGroupIndex >= agentGroups.length) {
      return { content: [{ type: 'text' as const, text: 'All tasks completed! No more tasks to execute.' }] };
    }

    const group = agentGroups[agentGroupIndex];
    const pendingInGroup = group.filter((t) => !completedIds.has(t.id));

    if (pendingInGroup.length === 0) {
      agentGroupIndex++;
      agentTaskIndex = 0;
      if (agentGroupIndex >= agentGroups.length) {
        return { content: [{ type: 'text' as const, text: 'All tasks completed! No more tasks to execute.' }] };
      }
      return await server.tool.bind(server)('autopilot_next' as never, { cwd } as never) as never;
    }

    const task = pendingInGroup[0];

    let text = `--- Task: ${task.id} ---\n`;
    text += `Description: ${task.description}\n`;
    if (task.detail) text += `Detail: ${task.detail}\n`;
    text += `Mode: ${task.mode}\n`;
    if (task.phase) text += `Phase: ${task.phase}\n`;
    if (task.dependencies.length > 0) text += `Dependencies: ${task.dependencies.join(', ')}\n`;

    if (changedFiles.length > 0) {
      text += `\nContext — files changed by previous tasks:\n`;
      text += changedFiles.map((f) => `  - ${f}`).join('\n') + '\n';
    }

    text += `\nInstructions:\n`;
    text += `- Implement only what is described above\n`;
    text += `- Do not modify unrelated files\n`;
    text += `- Ensure the code compiles without errors\n`;
    text += `\nAfter implementing, call autopilot_complete with taskId="${task.id}" and list the files you changed.`;

    if (pendingInGroup.length > 1) {
      text += `\n\nNote: This group has ${pendingInGroup.length} parallel tasks. After completing this one, call autopilot_next for the remaining: ${pendingInGroup.slice(1).map((t) => t.id).join(', ')}`;
    }

    return { content: [{ type: 'text' as const, text }] };
  },
);

server.tool(
  'autopilot_complete',
  'Mark a task as completed and report which files were changed. Call this after implementing a task from autopilot_next.',
  {
    taskId: z.string().describe('ID of the completed task'),
    filesChanged: z.array(z.string()).optional().describe('List of files that were created or modified'),
    cwd: z.string().describe('Working directory of the target project'),
  },
  async ({ taskId, filesChanged, cwd }) => {
    if (!agentTasks.find((t) => t.id === taskId)) {
      return { content: [{ type: 'text' as const, text: `Error: Task "${taskId}" not found in plan.` }] };
    }

    if (completedIds.has(taskId)) {
      return { content: [{ type: 'text' as const, text: `Task "${taskId}" already completed.` }] };
    }

    completedIds.add(taskId);

    if (filesChanged) {
      for (const f of filesChanged) {
        if (!changedFiles.includes(f)) changedFiles.push(f);
      }
    }

    const total = agentTasks.length;
    const done = completedIds.size;
    const remaining = total - done;

    let text = `Task "${taskId}" completed. (${done}/${total})\n`;

    if (remaining === 0) {
      text += `\nAll ${total} tasks completed! You can now commit and create PRs.`;
    } else {
      text += `${remaining} tasks remaining. Call autopilot_next for the next task.`;
    }

    return { content: [{ type: 'text' as const, text }] };
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
