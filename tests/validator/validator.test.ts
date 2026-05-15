import { describe, it, expect, beforeEach } from 'vitest';
import { validateCode, type CommandRunner } from '../../src/validator/validator.js';
import type { AutopilotConfig } from '../../src/types.js';

let spawnResults: Array<{ output: string; exitCode: number }> = [];
let callIndex = 0;

const mockRunner: CommandRunner = async () => {
  const result = spawnResults[callIndex] ?? { output: '', exitCode: 0 };
  callIndex++;
  return result;
};

function makeConfig(
  overrides: Partial<AutopilotConfig['validation']> = {},
): Pick<AutopilotConfig, 'validation'> {
  return {
    validation: {
      typecheck: true,
      test: true,
      build: false,
      maxRetries: 3,
      ...overrides,
    },
  };
}

describe('validateCode', () => {
  beforeEach(() => {
    callIndex = 0;
    spawnResults = [];
  });

  it('모든 단계가 통과하면 passed: true를 반환한다', async () => {
    spawnResults = [
      { output: 'src/types.ts', exitCode: 0 },
      { output: '', exitCode: 0 },
      { output: 'Tests passed', exitCode: 0 },
    ];

    const result = await validateCode(makeConfig(), '/tmp', mockRunner);

    expect(result.passed).toBe(true);
    expect(result.steps).toHaveLength(3);
    expect(result.steps.map((s) => s.step)).toEqual(['diff', 'typecheck', 'test']);
  });

  it('diff가 없으면 즉시 실패한다', async () => {
    spawnResults = [{ output: '', exitCode: 0 }];

    const result = await validateCode(makeConfig(), '/tmp', mockRunner);

    expect(result.passed).toBe(false);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].step).toBe('diff');
  });

  it('typecheck 실패 시 이후 단계를 실행하지 않는다', async () => {
    spawnResults = [
      { output: 'src/file.ts', exitCode: 0 },
      { output: 'error TS2345', exitCode: 1 },
    ];

    const result = await validateCode(makeConfig(), '/tmp', mockRunner);

    expect(result.passed).toBe(false);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[1].step).toBe('typecheck');
    expect(result.steps[1].passed).toBe(false);
  });

  it('test 실패 시 이후 단계를 실행하지 않는다', async () => {
    spawnResults = [
      { output: 'src/file.ts', exitCode: 0 },
      { output: '', exitCode: 0 },
      { output: 'FAIL test/x.test.ts', exitCode: 1 },
    ];

    const result = await validateCode(makeConfig(), '/tmp', mockRunner);

    expect(result.passed).toBe(false);
    expect(result.steps).toHaveLength(3);
    expect(result.steps[2].step).toBe('test');
    expect(result.steps[2].passed).toBe(false);
  });

  it('build가 비활성화되면 build 단계를 건너뛴다', async () => {
    spawnResults = [
      { output: 'src/file.ts', exitCode: 0 },
      { output: '', exitCode: 0 },
      { output: 'Tests passed', exitCode: 0 },
    ];

    const result = await validateCode(makeConfig({ build: false }), '/tmp', mockRunner);

    const buildStep = result.steps.find((s) => s.step === 'build');
    expect(buildStep).toBeUndefined();
  });

  it('build가 활성화되면 build 단계를 실행한다', async () => {
    spawnResults = [
      { output: 'src/file.ts', exitCode: 0 },
      { output: '', exitCode: 0 },
      { output: 'Tests passed', exitCode: 0 },
      { output: 'Build success', exitCode: 0 },
    ];

    const result = await validateCode(makeConfig({ build: true }), '/tmp', mockRunner);

    expect(result.passed).toBe(true);
    expect(result.steps).toHaveLength(4);
    expect(result.steps[3].step).toBe('build');
  });
});
