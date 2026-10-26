// @vitest-environment node

import type { ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const moduleUrl = pathToFileURL(
  resolve('tools/builder-oauth-spike/child-lifecycle.mjs')
).href;
const { startChild, stopChild } = (await import(moduleUrl)) as {
  startChild(
    module: URL,
    args: string[]
  ): { child: ChildProcess; ready: Promise<unknown> };
  stopChild(child: ChildProcess): Promise<void>;
};
const children: ChildProcess[] = [];
afterEach(async () => {
  await Promise.all(children.splice(0).map(stopChild));
});
describe('owned child lifecycle', () => {
  it('handles readiness and idempotent shutdown', async () => {
    const launched = startChild(new URL('./fixtures/child.mjs', moduleUrl), [
      'ready',
    ]);
    children.push(launched.child);
    await expect(launched.ready).resolves.toEqual({ ready: true });
    await stopChild(launched.child);
    await stopChild(launched.child);
    expect(launched.child.signalCode).toBe('SIGTERM');
  });
  it('rejects an exited child without waiting for timeout', async () => {
    const launched = startChild(new URL('./fixtures/child.mjs', moduleUrl), [
      'exit',
    ]);
    children.push(launched.child);
    await expect(launched.ready).rejects.toThrow('exited before ready');
    await stopChild(launched.child);
  });
});
