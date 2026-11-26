import { createServer } from 'node:net';
import { decodeJwt } from 'jose';
import { expect, vi } from 'vitest';
import { startProductionBuilderStack } from '@/lib/experience/production-builder-stack';
import { createLinkedSessionService } from '../../tools/builder-auth/session-service';
import type { experienceDataFixture } from './data-fixture.test-support';
import type { setupNewMerchantRunner } from './new-merchant-runner.test-support';
import type { setupPublishedRendererPool } from './published-renderer-pool.test-support';
import type { syntheticOAuth } from './synthetic-oauth.test-support';

async function unusedPort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) =>
    server.once('error', reject).listen(0, '127.0.0.1', resolve)
  );
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('NO_PORT');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  return address.port;
}

export async function startNewMerchantMcp(
  f: Awaited<ReturnType<typeof experienceDataFixture>>,
  oauth: Awaited<ReturnType<typeof syntheticOAuth>>,
  runner: Awaited<ReturnType<typeof setupNewMerchantRunner>>,
  dir: string,
  initialToken: string,
  readPublishedRenderer: Awaited<
    ReturnType<typeof setupPublishedRendererPool>
  >['read']
) {
  const actorId = f.otherActorId;
  let token = initialToken;
  const { publicJwk } = oauth;
  const background = process.env.BACI_LOCAL_BACKGROUND_BUILD_TEST === '1';
  const resolveLinkedAccessToken = createLinkedSessionService({
    storage: f.db.storage,
    refresh: () => Promise.reject(Error('Unexpected refresh')),
    verifyUser: (accessToken) =>
      accessToken === f.other.accessToken
        ? Promise.resolve(actorId)
        : Promise.reject(Error('Wrong synthetic user')),
  });
  const port = await unusedPort();
  let deliveryPort = await unusedPort();
  while (deliveryPort === port) deliveryPort = await unusedPort();
  const verifier = runner.verifier;
  let ownerPort = verifier ? await unusedPort() : undefined;
  while (
    verifier &&
    (ownerPort === deliveryPort ||
      ownerPort === port ||
      ownerPort === verifier.port)
  )
    ownerPort = await unusedPort();
  const stack = await startProductionBuilderStack({
    ...(verifier
      ? {
          ownerPort,
          verifierPort: verifier.port,
          verifierKey: verifier.key,
        }
      : {}),
    port,
    deliveryPort,
    ...(background
      ? {
          backgroundWorker: {
            schedule: (callback: () => void) => {
              const timer = setInterval(callback, 5000);
              return () => clearInterval(timer);
            },
          },
        }
      : {}),
    host: {
      startBroker: () =>
        Promise.resolve({
          runtime: {
            readConnection: f.db.storage.readConnection,
            resolveLinkedAccessToken,
            listBuildConnections: f.db.storage.listActiveEditConnections,
            resolveBuildToken: resolveLinkedAccessToken,
            resolveBuildUser: (accessToken: string) =>
              accessToken === f.other.accessToken
                ? Promise.resolve({
                    actorUserId: actorId,
                    client: f.other.supabase,
                  })
                : Promise.reject(Error('Wrong synthetic user')),
          },
          publicBinding: {
            supabase: {
              url: 'https://synthetic.supabase.co',
              anonKey: 'synthetic-public',
            },
            jwks: { keys: [publicJwk] },
          },
          close: () => Promise.resolve(),
        }),
      integration: {
        hostOrigin: 'https://builder.synthetic.test',
        executionOrigin: 'https://output.synthetic-output.test',
        artifactDirectory: dir,
        canonicalBase: (slug) => `https://${slug}.synthetic.test`,
        publicClient: f.anonymous,
        readPublishedRenderer,
        approval: {
          load: vi.fn(),
          confirm: vi.fn(),
          loadLifecycle: vi.fn(),
          confirmPublication: vi.fn(),
          confirmModeExit: vi.fn(),
        },
        runner: runner.runner,
        build: runner.build,
        bootstrap: runner.bootstrap,
        ...('remoteCapture' in runner
          ? { remoteCapture: runner.remoteCapture }
          : { recordCapture: runner.recordCapture }),
      },
    },
  });
  async function call(name: string, args: Record<string, unknown>) {
    if ((decodeJwt(token).exp ?? 0) <= Math.floor(Date.now() / 1000) + 30)
      token = await oauth.refresh();
    const response = await fetch(`http://127.0.0.1:${port}/builder/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    });
    expect(response.status).toBe(200);
    return response.json();
  }
  return { stack, call, background };
}

export type NewMerchantMcpCall = Awaited<
  ReturnType<typeof startNewMerchantMcp>
>['call'];
