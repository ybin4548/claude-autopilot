import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

const PROFILE_DIR = join(homedir(), '.claude-autopilot', 'profiles');

export interface ProjectProfile {
  project: string;
  patterns: {
    language: string;
    branchStrategy: string;
    prTarget: string;
    commitStyle: string;
    testFramework: string;
    testLocation: string;
  };
  claudeMd: string;
  learnedAt: string;
}

function projectHash(cwd: string): string {
  return createHash('md5').update(cwd).digest('hex').slice(0, 12);
}

function profilePath(cwd: string): string {
  return join(PROFILE_DIR, `${projectHash(cwd)}.json`);
}

function runGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.on('close', () => resolve(Buffer.concat(chunks).toString('utf-8').trim()));
  });
}

async function readOptionalFile(path: string): Promise<string> {
  try { return await readFile(path, 'utf-8'); } catch { return ''; }
}

function detectCommitStyle(logs: string): string {
  if (/^[✨🐛📝♻️✅📦🎉]/.test(logs)) return 'emoji-prefix';
  if (/^(feat|fix|chore|docs|refactor|test)\(/.test(logs)) return 'conventional-commits';
  return 'freeform';
}

function detectBranchStrategy(branches: string): string {
  if (branches.includes('feat/') || branches.includes('feature/')) return 'gitflow';
  return 'simple';
}

function detectTestFramework(pkg: string): string {
  if (pkg.includes('vitest')) return 'vitest';
  if (pkg.includes('jest')) return 'jest';
  if (pkg.includes('mocha')) return 'mocha';
  return 'unknown';
}

function detectLanguage(cwd: string, files: string): string {
  if (files.includes('tsconfig.json')) return 'TypeScript';
  if (files.includes('package.json')) return 'JavaScript';
  if (files.includes('Package.swift')) return 'Swift';
  if (files.includes('Cargo.toml')) return 'Rust';
  if (files.includes('go.mod')) return 'Go';
  if (files.includes('requirements.txt') || files.includes('pyproject.toml')) return 'Python';
  return 'unknown';
}

export async function learnProject(cwd: string): Promise<ProjectProfile> {
  await mkdir(PROFILE_DIR, { recursive: true });

  const [logs, branches, files, claudeMd, pkg] = await Promise.all([
    runGit(['log', '--oneline', '-20'], cwd),
    runGit(['branch', '-a'], cwd),
    runGit(['ls-files'], cwd),
    readOptionalFile(join(cwd, 'CLAUDE.md')),
    readOptionalFile(join(cwd, 'package.json')),
  ]);

  const testLocation = files.includes('tests/') ? 'tests/' :
    files.includes('__tests__/') ? '__tests__/' :
    files.includes('test/') ? 'test/' : 'unknown';

  const profile: ProjectProfile = {
    project: cwd,
    patterns: {
      language: detectLanguage(cwd, files),
      branchStrategy: detectBranchStrategy(branches),
      prTarget: 'dev',
      commitStyle: detectCommitStyle(logs),
      testFramework: detectTestFramework(pkg),
      testLocation,
    },
    claudeMd: claudeMd.slice(0, 2000),
    learnedAt: new Date().toISOString(),
  };

  await writeFile(profilePath(cwd), JSON.stringify(profile, null, 2), 'utf-8');
  return profile;
}

export async function loadProfile(cwd: string): Promise<ProjectProfile | null> {
  try {
    const raw = await readFile(profilePath(cwd), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function profileToContext(profile: ProjectProfile): string {
  const lines = [
    `Project: ${profile.project}`,
    `Language: ${profile.patterns.language}`,
    `Branch strategy: ${profile.patterns.branchStrategy}`,
    `Commit style: ${profile.patterns.commitStyle}`,
    `Test framework: ${profile.patterns.testFramework}`,
    `Test location: ${profile.patterns.testLocation}`,
  ];

  if (profile.claudeMd) {
    lines.push('', 'CLAUDE.md rules:', profile.claudeMd.slice(0, 500));
  }

  return lines.join('\n');
}
