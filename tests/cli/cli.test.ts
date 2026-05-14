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
    expect(result).toEqual({ command: 'run', planFile: 'plan.md' });
  });

  it('run --github owner/repo 를 파싱한다', () => {
    const result = parseArgs(['node', 'cli', 'run', '--github', 'owner/repo']);
    expect(result).toEqual({ command: 'run', github: 'owner/repo' });
  });

  it('status 명령을 파싱한다', () => {
    const result = parseArgs(['node', 'cli', 'status']);
    expect(result).toEqual({ command: 'status' });
  });

  it('resume 명령을 파싱한다', () => {
    const result = parseArgs(['node', 'cli', 'resume']);
    expect(result).toEqual({ command: 'resume' });
  });

  it('잘못된 명령은 exit한다', () => {
    expect(() => parseArgs(['node', 'cli', 'invalid'])).toThrow('process.exit');
  });

  it('명령 없이 실행하면 exit한다', () => {
    expect(() => parseArgs(['node', 'cli'])).toThrow('process.exit');
  });
});
