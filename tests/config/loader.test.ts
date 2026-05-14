import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, DEFAULT_CONFIG, detectValidation } from '../../src/config/loader.js';

let tempDir: string;

describe('loadConfig', () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'autopilot-cfg-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('.autopilotrc.json이 있으면 해당 값을 오버라이드한다', async () => {
    await writeFile(
      join(tempDir, '.autopilotrc.json'),
      JSON.stringify({
        validation: { typecheck: false, test: false },
        git: { baseBranch: 'main' },
      }),
    );

    const config = await loadConfig(tempDir);
    expect(config.validation.typecheck).toBe(false);
    expect(config.validation.test).toBe(false);
    expect(config.git.baseBranch).toBe('main');
    expect(config.git.branchPrefix).toBe('autopilot/');
  });

  it('깊은 병합이 올바르게 동작한다', async () => {
    await writeFile(
      join(tempDir, '.autopilotrc.json'),
      JSON.stringify({
        merge: { method: 'rebase' },
      }),
    );

    const config = await loadConfig(tempDir);
    expect(config.merge.method).toBe('rebase');
    expect(config.merge.strategy).toBe('auto');
  });
});

describe('detectValidation', () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'autopilot-detect-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('tsconfig.json이 없으면 typecheck=false', async () => {
    const result = await detectValidation(tempDir);
    expect(result.typecheck).toBe(false);
  });

  it('tsconfig.json이 있으면 typecheck=true', async () => {
    await writeFile(join(tempDir, 'tsconfig.json'), '{}');
    const result = await detectValidation(tempDir);
    expect(result.typecheck).toBe(true);
  });

  it('npm test가 placeholder면 test=false', async () => {
    await writeFile(
      join(tempDir, 'package.json'),
      JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }),
    );
    const result = await detectValidation(tempDir);
    expect(result.test).toBe(false);
  });

  it('npm test가 실제 명령이면 test=true', async () => {
    await writeFile(
      join(tempDir, 'package.json'),
      JSON.stringify({ scripts: { test: 'vitest run' } }),
    );
    const result = await detectValidation(tempDir);
    expect(result.test).toBe(true);
  });

  it('build 스크립트가 있으면 build=true', async () => {
    await writeFile(
      join(tempDir, 'package.json'),
      JSON.stringify({ scripts: { test: 'jest', build: 'tsc' } }),
    );
    const result = await detectValidation(tempDir);
    expect(result.build).toBe(true);
  });

  it('package.json이 없으면 test=false, build=false', async () => {
    const result = await detectValidation(tempDir);
    expect(result.test).toBe(false);
    expect(result.build).toBe(false);
  });

  it('auto-detect는 명시적 설정이 없을 때만 적용된다', async () => {
    // tsconfig 없는 JS 프로젝트지만 .autopilotrc.json에서 typecheck=true 명시
    await writeFile(
      join(tempDir, 'package.json'),
      JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }),
    );
    await writeFile(
      join(tempDir, '.autopilotrc.json'),
      JSON.stringify({ validation: { typecheck: true, test: true } }),
    );

    const config = await loadConfig(tempDir);
    expect(config.validation.typecheck).toBe(true);
    expect(config.validation.test).toBe(true);
  });
});
