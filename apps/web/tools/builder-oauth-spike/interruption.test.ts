// @vitest-environment node

import type { ChildProcess } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';

const moduleUrl = pathToFileURL(
  resolve('tools/builder-oauth-spike/child-lifecycle.mjs')
).href;
const { startChild, stopChild } = (await import(moduleUrl)) as {
  startChild(
    module: URL,
    args: string[]
  ): { child: ChildProcess; ready: Promise<{ dir: string }> };
  stopChild(child: ChildProcess): Promise<void>;
};
it.skipIf(process.env.BACI_BUILDER_OAUTH_PROBE !== '1')(
  'removes CIMD private fixture files on SIGTERM',
  async () => {
    const launched = startChild(new URL('./cimd.probe.mjs', moduleUrl), [
      '--hold-for-interruption',
    ]);
    let ownedDir: string | undefined;
    try {
      const { dir } = await launched.ready;
      ownedDir = dir;
      expect(dir).toContain('baci-cimd-proof-');
      expect(existsSync(`${dir}/key.pem`)).toBe(true);
      expect(existsSync(`${dir}/state.sqlite`)).toBe(true);
      await stopChild(launched.child);
      expect(existsSync(dir)).toBe(false);
    } finally {
      await stopChild(launched.child);
      if (ownedDir?.includes('baci-cimd-proof-'))
        rmSync(ownedDir, { recursive: true, force: true });
    }
  }
);
