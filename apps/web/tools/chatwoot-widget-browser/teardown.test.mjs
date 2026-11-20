import './test-env.test-setup.mjs';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { teardown } from './teardown.mjs';

describe('chatwoot-widget-browser teardown', () => {
  it('closes browser, server, proxy, and removes tempDir', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cw-teardown-'));
    const closeBrowser = vi.fn().mockResolvedValue(undefined);
    const closeServer = vi.fn((cb) => cb());
    const killProxy = vi.fn();
    const state = {
      tempDir: dir,
      browser: { close: closeBrowser },
      frontServer: { listening: true, close: closeServer },
      proxy: {
        exitCode: null,
        kill: killProxy,
        once: vi.fn((event, cb) => {
          if (event === 'exit') cb();
        }),
      },
    };

    await teardown(state);

    expect(closeBrowser).toHaveBeenCalledTimes(1);
    expect(closeServer).toHaveBeenCalledTimes(1);
    expect(killProxy).toHaveBeenCalledWith('SIGTERM');
    await expect(stat(dir)).rejects.toThrow();
  });
});
