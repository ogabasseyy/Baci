// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { expect, it } from 'vitest';
import type { startGatewayServer } from './server';

it('runs discovery and auth denial from the standalone production bundle', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'baci-gateway-bundle-'));
  try {
    const outfile = join(dir, 'server.cjs');
    await build({
      entryPoints: ['tools/connector-gateway/server.ts'],
      outfile,
      bundle: true,
      platform: 'node',
      target: 'node24',
      format: 'cjs',
    });
    const bundled = createRequire(import.meta.url)(outfile) as {
      startGatewayServer: typeof startGatewayServer;
    };
    const server = await bundled.startGatewayServer({
      host: '127.0.0.1',
      port: 0,
      databaseUrl: 'postgres://connector_gateway:test@127.0.0.1:1/postgres',
      localGrantManagement: null,
      publicBaseUrl: 'https://muse-api.usebaci.com',
      rateLimitPerKey: 120,
      rateLimitPerIp: 600,
      rateLimitWindowMs: 60_000,
      trustedProxies: ['127.0.0.1'],
    });
    try {
      const discovery = await fetch(`${server.baseUrl}/openapi.json`);
      expect(discovery.status).toBe(200);
      expect(Object.keys((await discovery.json()).paths)).toHaveLength(4);
      const denied = await fetch(`${server.baseUrl}/v0/tools/orders.list`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      expect(denied.status).toBe(401);
      expect(await denied.json()).toMatchObject({ code: 'GRANT_REVOKED' });
    } finally {
      await server.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 15_000);
