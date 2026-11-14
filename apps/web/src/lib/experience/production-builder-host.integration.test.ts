// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const userClient = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/authenticated-user-client', () => ({
  createAuthenticatedUserClient: userClient,
}));

import { getInstalledBuilderGateway } from '@/lib/builder-gateway/runtime';
import { createTransientOutputStore } from '../../../tools/experience-runner/transient-output-store';
import { startProductionBuilderHost } from './production-builder-host';

it('routes a signed builder request through the installed host and denies a revoked grant', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'baci-host-integration-'));
  const actor = '10000000-0000-4000-8000-000000000001';
  const connection = '20000000-0000-4000-8000-000000000001';
  const merchant = '30000000-0000-4000-8000-000000000001';
  let host: Awaited<ReturnType<typeof startProductionBuilderHost>> | undefined;
  try {
    const key = await generateKeyPair('ES256', { extractable: true });
    const row = {
      actorUserId: actor,
      connectionId: connection,
      grantVersion: 1,
      scopes: ['storefront.read'],
      allowedMerchantIds: [merchant],
      allowCreateStore: false,
      status: 'active',
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      revokedAt: null as string | null,
    };
    const rpc = vi.fn(async () => ({
      data: [
        {
          id: merchant,
          business_name: 'Synthetic Store',
          slug: 'synthetic',
          template_id: null,
          draft_config: null,
          version: null,
          is_published: false,
        },
      ],
      error: null,
    }));
    userClient.mockResolvedValue({ rpc });
    const close = vi.fn(async () => {});
    host = await startProductionBuilderHost({
      startBroker: async () => ({
        runtime: {
          readConnection: async () => row,
          resolveLinkedAccessToken: async () => 'synthetic-token',
        },
        publicBinding: {
          supabase: {
            url: 'https://synthetic.supabase.co',
            anonKey: 'synthetic-public',
          },
          jwks: {
            keys: [
              {
                ...(await exportJWK(key.publicKey)),
                alg: 'ES256',
                kid: 'synthetic',
              },
            ],
          },
        },
        close,
      }),
      integration: {
        hostOrigin: 'https://builder.baci.test',
        executionOrigin: 'https://output.runtime.test',
        artifactDirectory: dir,
        canonicalBase: (slug: string) =>
          `https://${slug}.merchant.test/${slug}`,
        publicClient: { rpc: vi.fn() } as never,
        approval: {
          load: vi.fn(),
          confirm: vi.fn(),
          loadLifecycle: vi.fn(),
          confirmPublication: vi.fn(),
          confirmModeExit: vi.fn(),
        },
        runner: {
          endpoint: 'https://runner.runtime.test/v1/execute',
          key: new Uint8Array(32).fill(1),
          toolchainDigest: 'a'.repeat(64),
        },
        build: {
          key: new Uint8Array(32).fill(2),
          toolchainDigest: 'a'.repeat(64),
          transient: createTransientOutputStore(),
          recordVerifiedEvidence: vi.fn(),
        },
        bootstrap: vi.fn(),
        recordCapture: vi.fn(),
      },
    });
    const token = await new SignJWT({
      connectionId: connection,
      grantVersion: 1,
      scope: 'storefront.read',
    })
      .setProtectedHeader({ alg: 'ES256', kid: 'synthetic', typ: 'at+jwt' })
      .setIssuer('https://builder-auth.usebaci.com')
      .setAudience('https://mcp.usebaci.com/builder/mcp')
      .setSubject(actor)
      .setExpirationTime('5m')
      .sign(key.privateKey);
    const request = () =>
      new Request(
        'https://usebaci.com/api/integrations/chatgpt/builder/list_storefronts',
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: '{}',
        }
      );
    const gateway = getInstalledBuilderGateway();
    expect(gateway).toBeDefined();
    const response = await gateway?.(request(), 'list_storefronts');
    expect(response?.status).toBe(200);
    expect(await response?.json()).toMatchObject({
      stores: [
        { storefrontId: merchant, name: 'Synthetic Store', slug: 'synthetic' },
      ],
    });
    expect(rpc).toHaveBeenCalledWith('builder_read_storefronts', {
      p_connection: connection,
      p_version: 1,
      p_merchant: null,
    });
    row.status = 'revoked';
    row.revokedAt = new Date().toISOString();
    expect((await gateway?.(request(), 'list_storefronts'))?.status).toBe(401);
    await host.close();
    host = undefined;
    expect(getInstalledBuilderGateway()).toBeUndefined();
    expect(close).toHaveBeenCalledOnce();
  } finally {
    await host?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
