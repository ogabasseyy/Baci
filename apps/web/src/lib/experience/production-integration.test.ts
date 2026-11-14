// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { parseExperienceManifest } from '@/schemas/experience-manifest';
import { createTransientOutputStore } from '../../../tools/experience-runner/transient-output-store';
import { getExperienceOwnerRuntime } from './owner-runtime';
import { createProductionExperienceIntegration } from './production-integration';

function fixture(directory: string) {
  const rpc = vi.fn();
  const runnerFetch = vi.fn<typeof fetch>();
  const authenticate = vi.fn();
  const resolveUserClient = vi.fn();
  const settings: Parameters<typeof createProductionExperienceIntegration>[0] =
    {
      hostOrigin: 'https://builder.baci.test',
      executionOrigin: 'https://output.baci-runtime.test',
      canonicalBase: (slug) => `https://${slug}.merchant.test/${slug}`,
      artifactDirectory: directory,
      publicClient: { rpc } as never,
      authenticate,
      resolveUserClient,
      legacyGateway: vi.fn(),
      approval: {
        load: vi.fn(),
        confirm: vi.fn(),
        loadLifecycle: vi.fn(),
        confirmPublication: vi.fn(),
        confirmModeExit: vi.fn(),
      },
      runner: {
        endpoint: 'https://runner.baci-runtime.test/v1/execute',
        key: new Uint8Array(32).fill(1),
        toolchainDigest: 'a'.repeat(64),
        fetch: runnerFetch,
      },
      build: {
        key: new Uint8Array(32).fill(2),
        toolchainDigest: 'a'.repeat(64),
        transient: createTransientOutputStore(),
        recordVerifiedEvidence: vi.fn(),
      },
      bootstrap: vi.fn(),
      recordCapture: vi.fn(),
    };
  return { settings, rpc, runnerFetch, authenticate, resolveUserClient };
}
it('composes normal MCP/build/preview/delivery ports without installing authority, reading tenants or contacting a runner', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'baci-production-ports-'));
  try {
    const f = fixture(directory);
    const integration = createProductionExperienceIntegration(f.settings);
    expect(integration.composition.profile).toBe('production');
    expect(integration.composition.hostOrigin).toBe(
      'https://builder.baci.test'
    );
    expect(integration.composition.dispatcher.rendering).toBe(
      'prerender-private'
    );
    expect(integration.composition.dispatcher.resolveUserClient).toBeTypeOf(
      'function'
    );
    expect(integration.composition.authenticate).toBeTypeOf('function');
    expect(getExperienceOwnerRuntime()).toBeUndefined();
    expect(f.rpc).not.toHaveBeenCalled();
    expect(f.runnerFetch).not.toHaveBeenCalled();
    expect(
      (
        await integration.deliver(
          new Request('https://output.baci-runtime.test/source.tsx')
        )
      ).status
    ).toBe(404);
    expect(f.rpc).not.toHaveBeenCalled();
    integration.dispose();
    await expect(
      integration.composition.authenticate(
        new Request('https://builder.baci.test')
      )
    ).rejects.toThrow('PROFILE_DISABLED');
    await expect(
      integration.composition.dispatcher.resolveUserClient({} as never)
    ).rejects.toThrow('PROFILE_DISABLED');
    expect(f.authenticate).not.toHaveBeenCalled();
    expect(f.resolveUserClient).not.toHaveBeenCalled();
    expect(
      (
        await integration.deliver(
          new Request('https://output.baci-runtime.test/source.tsx')
        )
      ).status
    ).toBe(503);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
it('admits read-only performance grants without demanding write scope', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'baci-production-read-scope-'));
  try {
    const f = fixture(directory);
    const integration = createProductionExperienceIntegration(f.settings);
    const rpc = vi.fn(async (_name: string) => ({ data: true, error: null }));
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: async () => ({ data: { slug: 'alpha' }, error: null }),
    };
    const ctx = {
      merchantId: 'merchant',
      identity: {
        actorUserId: 'owner',
        connectionId: 'connection',
        grantVersion: 1,
        allowedMerchantIds: ['merchant'],
        scopes: new Set(['storefront.read'] as const),
        allowCreateStore: false,
      },
      supabase: {
        auth: {
          getUser: async () => ({
            data: { user: { id: 'owner' } },
            error: null,
          }),
        },
        rpc,
        from: () => query,
      } as never,
    };
    const read = integration.composition.dispatcher.readPerformance;
    if (!read) throw Error('Performance reader missing');
    const manifest = parseExperienceManifest({
      format: 'baci.experience/v2',
      runtime: 'react-browser-sandbox/v1',
      sdkVersion: 'commerce-bridge/v1',
      entry: 'app.tsx',
      files: [{ path: 'app.tsx', content: 'export default()=>null' }],
      packages: [],
      routes: [{ path: '/', view: 'home' }],
      assets: [],
      capabilities: [],
    });
    await expect(
      read(
        {
          merchantId: 'merchant',
          buildId: 'build',
          buildDigest: 'a'.repeat(64),
          sourceDigest: 'b'.repeat(64),
        },
        { ctx, manifest }
      )
    ).resolves.toBeUndefined();
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'experience_authorize_read',
    ]);
    integration.dispose();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
it('resolves each authorized merchant canonical base afresh and accepts the exact Baci preview origin', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'baci-production-tenants-'));
  try {
    const f = fixture(directory);
    const canonicalBase = vi.fn(async (slug: string) =>
      Promise.resolve(f.settings.canonicalBase(slug))
    );
    const integration = createProductionExperienceIntegration({
      ...f.settings,
      canonicalBase,
    });
    const context = (merchantId: string, slug: string, authorized = true) => {
      const filters: [string, string, unknown][] = [];
      const supabase = {
        auth: {
          getUser: vi.fn(async () => ({
            data: { user: { id: 'synthetic-owner' } },
            error: null,
          })),
        },
        rpc: vi.fn(async () => ({ data: authorized, error: null })),
        from: (table: string) => {
          const query = {
            select: vi.fn().mockReturnThis(),
            eq: (column: string, value: unknown) => {
              filters.push([table, column, value]);
              return query;
            },
            maybeSingle: async () => ({
              data: table === 'merchants' ? { slug } : null,
              error: null,
            }),
          };
          return query;
        },
      };
      return {
        ctx: {
          merchantId,
          supabase: supabase as never,
          requestOrigin: 'https://builder.baci.test',
        },
        filters,
      };
    };
    for (const slug of ['alpha', 'beta']) {
      const f = context(`synthetic-${slug}`, slug);
      await expect(
        integration.composition.owner.createPreviewLaunch(f.ctx, {
          buildId: 'missing',
          routeId: 'home',
        })
      ).rejects.toThrow('NOT_FOUND');
      expect(canonicalBase).toHaveBeenCalledWith(slug);
      expect(f.filters).toContainEqual(['merchants', 'id', f.ctx.merchantId]);
      expect(f.filters).toContainEqual([
        'experience_builds',
        'merchant_id',
        f.ctx.merchantId,
      ]);
    }
    const before = canonicalBase.mock.calls.length;
    await expect(
      integration.composition.owner.createPreviewLaunch(
        context('denied', 'other', false).ctx,
        { buildId: 'missing', routeId: 'home' }
      )
    ).rejects.toThrow('NOT_FOUND');
    expect(canonicalBase).toHaveBeenCalledTimes(before);
    expect(f.runnerFetch).not.toHaveBeenCalled();
    integration.dispose();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it('rejects authentication that completes after rollback disposes the integration', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'baci-production-rollback-'));
  try {
    const f = fixture(directory);
    const pending = Promise.withResolvers<never>();
    f.authenticate.mockReturnValue(pending.promise);
    const integration = createProductionExperienceIntegration(f.settings);
    const request = integration.composition.authenticate(
      new Request('https://builder.baci.test')
    );
    expect(f.authenticate).toHaveBeenCalledTimes(1);
    integration.dispose();
    pending.resolve({} as never);
    await expect(request).rejects.toThrow('PROFILE_DISABLED');
    expect(f.resolveUserClient).not.toHaveBeenCalled();
    expect(f.runnerFetch).not.toHaveBeenCalled();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
