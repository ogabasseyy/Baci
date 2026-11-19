import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

describe('chatwoot-widget-browser config', () => {
  afterEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  it('loads distinct synthetic tokens from a token file and normalizes resetDelayMs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cw-config-test-'));
    try {
      const tokenPath = join(dir, 'tokens.json');
      await writeFile(
        tokenPath,
        JSON.stringify({
          a: 'synthetic_token_a_1234',
          b: 'synthetic_token_b_5678',
        })
      );
      process.env.CHATWOOT_SYNTHETIC_TOKENS_FILE = tokenPath;
      delete process.env.CHATWOOT_SYNTHETIC_TOKEN_A;
      delete process.env.CHATWOOT_SYNTHETIC_TOKEN_B;
      process.env.CHATWOOT_FIXTURE_RESET_DELAY_MS = '150';

      const cfg = await import('./config.mjs');
      expect(cfg.tokenA).toBe('synthetic_token_a_1234');
      expect(cfg.tokenB).toBe('synthetic_token_b_5678');
      expect(cfg.resetDelayMs).toBe(150);
      expect(process.env.CHATWOOT_FIXTURE_RESET_DELAY_MS).toBe('150');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects missing or duplicate tokens', async () => {
    process.env.CHATWOOT_SYNTHETIC_TOKEN_A = 'synthetic_token_same_1234';
    process.env.CHATWOOT_SYNTHETIC_TOKEN_B = 'synthetic_token_same_1234';

    await expect(import('./config.mjs')).rejects.toThrow(
      'Provide two distinct synthetic Chatwoot website tokens'
    );
  });
});
