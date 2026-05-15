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

function buildTaskPrompt(task: Task): string {
  let text = `--- Task: ${task.id} ---\n`;
  text += `Description: ${task.description}\n`;
  if (task.detail) text += `Detail: ${task.detail}\n`;
  if (task.phase) text += `Phase: ${task.phase}\n`;
  if (task.dependencies.length > 0) text += `Dependencies: ${task.dependencies.join(', ')}\n`;
  text += `\n`;
  text += `- Implement only what is described above\n`;
  text += `- Do not modify unrelated files\n`;
  text += `- Ensure the code compiles without errors\n`;
  return text;
}

const server = new McpServer({
  name: 'claude-autopilot',
  version: '1.1.0',
});

// --- CLI mode tools ---

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
    return { content: [{ type: 'text' as const, text: result.stdout || `Exit code: ${result.exitCode}` }] };
  },
);

server.tool(
  'autopilot_status',
  'Check the current progress of a running autopilot plan',
  { cwd: z.string().optional().describe('Working directory (optional)') },
  async ({ cwd }) => {
    const result = await runCli(['status'], cwd ?? process.cwd());
    return { content: [{ type: 'text' as const, text: result.stdout || 'No active run found.' }] };
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
    return { content: [{ type: 'text' as const, text: result.stdout || `Exit code: ${result.exitCode}` }] };
  },
);

// --- Agent mode tools ---

server.tool(
  'autopilot_plan',
  'Parse and validate a plan file for agent mode. Returns task list and execution order. After this, call autopilot_next repeatedly — do NOT ask the user, just proceed automatically.',
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

      agentTasks = runnableTasks;
      agentGroups = groups;
      agentGroupIndex = 0;
      completedIds = new Set();
      changedFiles = [];

      const groupSummary = groups.map((g, i) =>
        `  Group ${i + 1}: ${g.map((t) => t.id).join(', ')}${g.length > 1 ? ' (parallel — use Agent tool to run simultaneously)' : ''}`
      ).join('\n');

      const validationSummary = [
        `PASS: ${report.passCount}`,
        report.warnCount > 0 ? `WARN: ${report.warnCount}` : '',
        report.failCount > 0 ? `FAIL: ${report.failCount}` : '',
        `Score: ${report.score}%`,
      ].filter(Boolean).join(', ');

      let text = `Plan loaded: ${runnableTasks.length} tasks in ${groups.length} groups\n`;
      text += `Validation: ${validationSummary}\n\n`;
      text += `Execution order:\n${groupSummary}\n\n`;
      text += `IMPORTANT: Proceed automatically without asking the user.\n`;
      text += `Call autopilot_next now to get the first group of tasks.`;

      return { content: [{ type: 'text' as const, text }] };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Error: ${err}` }] };
    }
  },
);

server.tool(
  'autopilot_next',
  'Get the next group of tasks to implement. If multiple tasks are returned, use the Agent tool to implement them in parallel (one subagent per task). Implement each task directly by reading/writing files. After ALL tasks in the group are done, call autopilot_complete for each, then call autopilot_next again. Do NOT ask the user — proceed automatically.',
  {
    cwd: z.string().describe('Working directory of the target project'),
  },
  async ({ cwd }) => {
    if (agentGroups.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No plan loaded. Call autopilot_plan first.' }] };
    }

    // Advance past completed groups
    while (agentGroupIndex < agentGroups.length) {
      const group = agentGroups[agentGroupIndex];
      const pending = group.filter((t) => !completedIds.has(t.id));
      if (pending.length > 0) break;
      agentGroupIndex++;
    }

    if (agentGroupIndex >= agentGroups.length) {
      const total = agentTasks.length;
      return { content: [{ type: 'text' as const, text: `All ${total} tasks completed! Commit the changes and create PRs as needed.` }] };
    }

    const group = agentGroups[agentGroupIndex];
    const pending = group.filter((t) => !completedIds.has(t.id));
    const groupNum = agentGroupIndex + 1;
    const totalGroups = agentGroups.length;

    let text = `=== Group ${groupNum}/${totalGroups} — ${pending.length} task${pending.length > 1 ? 's' : ''} ===\n\n`;

    if (changedFiles.length > 0) {
      text += `Context — files changed by previous tasks:\n`;
      text += changedFiles.map((f) => `  - ${f}`).join('\n') + '\n\n';
    }

    if (pending.length === 1) {
      text += buildTaskPrompt(pending[0]);
      text += `\nImplement this task now. After done, call autopilot_complete with taskId="${pending[0].id}".`;
    } else {
      text += `These ${pending.length} tasks are INDEPENDENT — implement them in PARALLEL using the Agent tool.\n`;
      text += `Spawn one subagent per task. Each subagent should implement its task and report back.\n\n`;

      for (const task of pending) {
        text += buildTaskPrompt(task);
        text += `---\n`;
      }

      text += `\nAfter ALL tasks are implemented, call autopilot_complete for each: ${pending.map((t) => t.id).join(', ')}`;
    }

    text += `\n\nDo NOT ask the user for confirmation. Proceed immediately.`;

    return { content: [{ type: 'text' as const, text }] };
  },
);

server.tool(
  'autopilot_complete',
  'Mark a task as completed. Call this after implementing each task. Then call autopilot_next for the next group. Do NOT ask the user — proceed automatically.',
  {
    taskId: z.string().describe('ID of the completed task'),
    filesChanged: z.array(z.string()).optional().describe('List of files that were created or modified'),
    cwd: z.string().describe('Working directory of the target project'),
  },
  async ({ taskId, filesChanged, cwd }) => {
    const task = agentTasks.find((t) => t.id === taskId);
    if (!task) {
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

    // Git instructions based on task mode
    let gitInstructions = '';
    if (task.mode === 'auto') {
      gitInstructions = `\nGit: Create branch "autopilot/${taskId}", commit changes, push, create PR to dev, and merge it. Do this automatically.`;
    } else {
      gitInstructions = `\nGit: Create branch "autopilot/${taskId}", commit changes, push, create PR to dev. Do NOT merge — wait for review.`;
    }

    // Check if current group is fully done
    const currentGroup = agentGroups[agentGroupIndex] ?? [];
    const groupDone = currentGroup.every((t) => completedIds.has(t.id));

    let text = `Task "${taskId}" completed. (${done}/${total})\n`;
    text += gitInstructions;

    if (done === total) {
      text += `\n\nAll ${total} tasks completed!`;
    } else if (groupDone) {
      text += `\n\nGroup ${agentGroupIndex + 1} fully completed. Call autopilot_next for the next group.`;
      text += `\nDo NOT ask the user — proceed immediately.`;
    } else {
      const remaining = currentGroup.filter((t) => !completedIds.has(t.id));
      text += `${remaining.length} tasks remaining in current group: ${remaining.map((t) => t.id).join(', ')}`;
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
