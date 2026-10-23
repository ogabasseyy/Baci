// @vitest-environment node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';

const url = pathToFileURL(
  resolve('tools/builder-oauth-spike/database-readiness.mjs')
).href;
const { waitForDatabase } = (await import(url)) as {
  waitForDatabase(
    run: (...args: string[]) => void,
    name: string,
    pause: () => Promise<void>
  ): Promise<void>;
};
it('ignores temporary initdb Unix readiness until the final TCP server is available', async () => {
  let tcpReady = false;
  const run = (...args: string[]) => {
    if (args.includes('-h') && !tcpReady)
      throw new Error('TCP unavailable while initdb socket is ready');
  };
  await waitForDatabase(run, 'owned-fixture', () => {
    tcpReady = true;
    return Promise.resolve();
  });
  expect(tcpReady).toBe(true);
});
it('fails boundedly when the final TCP server never starts', async () => {
  let attempts = 0;
  await expect(
    waitForDatabase(
      () => {
        attempts++;
        throw new Error('Not ready');
      },
      'owned-fixture',
      () => Promise.resolve()
    )
  ).rejects.toThrow('TCP readiness timeout');
  expect(attempts).toBe(60);
});
