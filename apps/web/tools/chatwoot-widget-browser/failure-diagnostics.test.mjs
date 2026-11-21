import './test-env.test-setup.mjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenA, tokenB } from './config.mjs';
import { reportFailure } from './failure-diagnostics.mjs';

describe('failure-diagnostics', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('redacts synthetic tenant tokens and query secrets from error output', async () => {
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await reportFailure(new Error(`boom ?website_token=${tokenA} ${tokenB}`), {
      phase: 'setup',
      blockedOrigins: new Set(),
      browserSignals: {
        consoleErrors: [],
        pageErrors: 0,
        failedLocalRequests: 0,
      },
    });

    const output = errorSpy.mock.calls.flat().join('\n');
    expect(output).not.toContain(tokenA);
    expect(output).not.toContain(tokenB);
    expect(output).toContain('[tenant B token redacted]');
  });
});
