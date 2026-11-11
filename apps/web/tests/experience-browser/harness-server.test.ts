import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { fixtureCatalog } from './fixtures/qualification-fixtures';
import { startQualificationServers } from './harness-server';

describe('loopback qualification serving', () => {
  it('serves digest-only memory assets, restrictive headers and opaque iframe', async () => {
    const bytes = Buffer.from('synthetic');
    const digest = createHash('sha256').update(bytes).digest('hex');
    const running = await startQualificationServers(
      {
        mode: 'test',
        engine: 'chromium',
        width: 390,
        bundle: { javascript: 'export {}', css: '' },
        catalog: fixtureCatalog,
        assets: [
          {
            assetId: 'image',
            digest,
            mime: 'image/png',
            bytesBase64: bytes.toString('base64'),
          },
          {
            assetId: 'font',
            digest,
            mime: 'font/woff2',
            bytesBase64: bytes.toString('base64'),
          },
        ],
      },
      new Map(),
      [0, 0]
    );
    try {
      const host = `http://127.0.0.1:${(running.servers[0].address() as AddressInfo).port}`;
      const execution = `http://127.0.0.1:${(running.servers[1].address() as AddressInfo).port}`;
      expect(await (await fetch(host)).text()).toContain(
        'sandbox="allow-scripts"'
      );
      const missing = await fetch(`${execution}/../../private?ticket=guess`);
      expect(missing.status).toBe(404);
      expect(missing.headers.get('content-security-policy')).toContain(
        "connect-src 'none'"
      );
      expect(await (await fetch(`${execution}/assets/${digest}`)).text()).toBe(
        'synthetic'
      );
    } finally {
      for (const server of running.servers) server.close();
    }
  });
});
