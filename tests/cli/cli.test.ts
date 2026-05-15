import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseArgs } from '../../src/cli.js';

describe('parseArgs', () => {
  beforeEach(() => {
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as never);
  });

  it('run <file> 을 파싱한다', () => {
    const result = parseArgs(['node', 'cli', 'run', 'plan.md']);
    expect(result).toMatchObject({ command: 'run', planFile: 'plan.md', noVisual: false });
  });

  it('run --github owner/repo 를 파싱한다', () => {
    const result = parseArgs(['node', 'cli', 'run', '--github', 'owner/repo']);
    expect(result).toMatchObject({ command: 'run', github: 'owner/repo', noVisual: false });
  });

  it('run --no-visual을 파싱한다', () => {
    const result = parseArgs(['node', 'cli', 'run', '--no-visual', 'plan.md']);
    expect(result).toMatchObject({ command: 'run', planFile: 'plan.md', noVisual: true });
  });

  it('status 명령을 파싱한다', () => {
    const result = parseArgs(['node', 'cli', 'status']);
    expect(result).toMatchObject({ command: 'status' });
  });

  it('resume 명령을 파싱한다', () => {
    const result = parseArgs(['node', 'cli', 'resume']);
    expect(result).toMatchObject({ command: 'resume' });
  });

  it('config 명령을 파싱한다', () => {
    const result = parseArgs(['node', 'cli', 'config']);
    expect(result).toMatchObject({ command: 'config' });
  });

  it('config --set을 파싱한다', () => {
    const result = parseArgs(['node', 'cli', 'config', '--set', 'merge.method=rebase']);
    expect(result).toMatchObject({ command: 'config', configSet: 'merge.method=rebase' });
  });

  it('init 명령을 파싱한다', () => {
    const result = parseArgs(['node', 'cli', 'init']);
    expect(result).toMatchObject({ command: 'init' });
  });

  it('잘못된 명령은 exit한다', () => {
    expect(() => parseArgs(['node', 'cli', 'invalid'])).toThrow('process.exit');
  });

  it('명령 없이 실행하면 exit한다', () => {
    expect(() => parseArgs(['node', 'cli'])).toThrow('process.exit');
  });
});
