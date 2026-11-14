// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPair, SignJWT } from 'jose';
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const userClient = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/authenticated-user-client', () => ({
  createAuthenticatedUserClient: userClient,
}));

import { getInstalledBuilderGateway } from '@/lib/builder-gateway/runtime';
import { createTransientOutputStore } from '../../../tools/experience-runner/transient-output-store';
import {
  createProductionBuilderPorts,
  installProductionBuilderPorts,
} from './production-builder-ports';

it('uses the same live connection and user-scoped RLS resolution for experience and legacy gateway', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'baci-builder-ports-'));
  const actor = '10000000-0000-4000-8000-000000000001';
  const connection = '20000000-0000-4000-8000-000000000001';
  try {
    const keys = await generateKeyPair('ES256');
    const row = {
      actorUserId: actor,
      connectionId: connection,
      grantVersion: 1,
      scopes: ['storefront.read'],
      allowedMerchantIds: [],
      allowCreateStore: false,
      status: 'active',
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      revokedAt: null as string | null,
    };
    const readConnection = vi.fn(async () => row);
    const resolveLinkedAccessToken = vi.fn(async () => 'synthetic-user-token');
    userClient.mockResolvedValue({ synthetic: true });
    const ports = createProductionBuilderPorts({
      signingKey: keys.publicKey,
      broker: { readConnection, resolveLinkedAccessToken },
      supabase: {
        url: 'https://synthetic.supabase.co',
        anonKey: 'synthetic-public',
      },
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
    expect(getInstalledBuilderGateway()).toBeUndefined();
    const service = installProductionBuilderPorts(ports);
    expect(getInstalledBuilderGateway()).toBeTypeOf('function');
    expect(() => installProductionBuilderPorts(ports)).toThrow(
      'PORTS_ALREADY_INSTALLED'
    );
    const token = await new SignJWT({
      connectionId: connection,
      grantVersion: 1,
      scope: 'storefront.read',
    })
      .setProtectedHeader({ alg: 'ES256', typ: 'at+jwt' })
      .setIssuer('https://builder-auth.usebaci.com')
      .setAudience('https://mcp.usebaci.com/builder/mcp')
      .setSubject(actor)
      .setExpirationTime('5m')
      .sign(keys.privateKey);
    const request = () =>
      new Request(
        'https://usebaci.com/api/integrations/chatgpt/builder/create_storefront_draft',
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: '{}',
        }
      );
    const identity = await ports.composition.authenticate(request());
    await ports.composition.dispatcher.resolveUserClient(identity);
    expect(resolveLinkedAccessToken).toHaveBeenCalledWith(identity);
    expect(userClient).toHaveBeenCalledWith({
      url: 'https://synthetic.supabase.co',
      anonKey: 'synthetic-public',
      accessToken: 'synthetic-user-token',
      actorUserId: actor,
    });
    expect(
      (
        await ports.composition.legacyGateway(
          request(),
          'create_storefront_draft'
        )
      ).status
    ).toBe(403);
    row.status = 'revoked';
    row.revokedAt = new Date().toISOString();
    await expect(ports.composition.authenticate(request())).rejects.toThrow();
    service.close();
    service.close();
    expect(getInstalledBuilderGateway()).toBeUndefined();
    expect(() => installProductionBuilderPorts(ports)).toThrow(
      'PORTS_ALREADY_INSTALLED'
    );
    expect(
      (
        await service.deliver(
          new Request('https://output.runtime.test/resource/invalid')
        )
      ).status
    ).toBe(503);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
