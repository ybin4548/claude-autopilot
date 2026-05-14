import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, DEFAULT_CONFIG } from '../../src/config/loader.js';

let tempDir: string;

describe('loadConfig', () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'autopilot-cfg-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('설정 파일이 없으면 기본값을 반환한다', async () => {
    const config = await loadConfig(tempDir);
    expect(config.defaultMode).toBe(DEFAULT_CONFIG.defaultMode);
    expect(config.validation.typecheck).toBe(true);
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
    expect(config.validation.build).toBe(false); // 기본값 유지
    expect(config.git.baseBranch).toBe('main');
    expect(config.git.branchPrefix).toBe('autopilot/'); // 기본값 유지
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
    expect(config.merge.strategy).toBe('auto'); // 기본값 유지
  });
});
