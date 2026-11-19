import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

describe('chatwoot-widget-browser vite.config', () => {
  afterEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  it('configures HTTPS, strict CSP headers, and fixture aliases', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-vite-test-'));
    try {
      const certPath = join(dir, 'cert.pem');
      const keyPath = join(dir, 'key.pem');
      writeFileSync(certPath, 'CERT');
      writeFileSync(keyPath, 'KEY');

      process.env.CHATWOOT_FIXTURE_PLATFORM_ORIGIN = 'https://localhost:43129';
      process.env.CHATWOOT_FIXTURE_CERT = certPath;
      process.env.CHATWOOT_FIXTURE_KEY = keyPath;
      process.env.CHATWOOT_SYNTHETIC_TOKEN_A = 'synthetic_token_a_1234';
      process.env.CHATWOOT_SYNTHETIC_TOKEN_B = 'synthetic_token_b_5678';

      const mod = await import('./vite.config');
      const cfg = mod.default;

      expect(cfg.server?.headers?.['Content-Security-Policy']).toContain(
        "frame-ancestors 'none'"
      );
      expect(cfg.server?.https).toEqual({
        cert: Buffer.from('CERT'),
        key: Buffer.from('KEY'),
      });
      expect(cfg.resolve?.alias).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ find: 'next/navigation' }),
        ])
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
