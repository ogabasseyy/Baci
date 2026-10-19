// @vitest-environment node
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('committed ChatGPT widget bundle', () => {
  it('matches the current source build', () => {
    const buildScript = fileURLToPath(new URL('./build.mjs', import.meta.url));
    expect(() => execFileSync(process.execPath, [buildScript, '--check'])).not.toThrow();
  });
});

it('bundles the host bridge independently of workspace SDK peer hoisting', async () => {
  await expect(build({
    entryPoints: [fileURLToPath(new URL('./src/mcp-app-bridge.ts', import.meta.url))],
    bundle: true, write: false, platform: 'browser', logLevel: 'silent',
    plugins: [{ name: 'reject-workspace-sdk-peers', setup(builder) {
      builder.onResolve({ filter: /^(@modelcontextprotocol\/(core|client)|zod)(\/|$)/ }, () => ({
        errors: [{ text: 'The browser SDK must not depend on workspace peer resolution.' }],
      }));
    } }],
  })).resolves.toBeDefined();
});
