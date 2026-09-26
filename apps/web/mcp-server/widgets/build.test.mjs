// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('committed ChatGPT widget bundle', () => {
  it('matches the current source build', () => {
    const buildScript = fileURLToPath(new URL('./build.mjs', import.meta.url));
    expect(() => execFileSync(process.execPath, [buildScript, '--check'])).not.toThrow();
  });
});
