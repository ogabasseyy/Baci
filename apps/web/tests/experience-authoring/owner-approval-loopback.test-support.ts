import { once } from 'node:events';
import { request } from 'node:http';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { expect, vi } from 'vitest';
import { POST } from '@/app/api/builder-experience/approval/route';
import { createOwnerLifecycleRuntime } from '@/lib/experience/owner-lifecycle-runtime';
import { installExperienceOwnerRuntime } from '@/lib/experience/owner-runtime';
import { createVerifierAttestationClient } from '@/lib/experience/verifier-attestation-client';
import { createBuilderMcpNodeServer } from '../../builder-mcp-server/node';
import { startVerifierListener } from '../../tools/experience-verifier/listener';
import { createVerifierLoopbackForwarder } from '../../tools/experience-verifier/loopback-forwarder';

export async function confirmSyntheticDraft(input: {
  handler: (request: Request) => Promise<Response>;
  key: Uint8Array;
  client: SupabaseClient;
  token: string;
  approvalId: string;
}) {
  const verifier = await startVerifierListener(input.handler, 0);
  let gateway: ReturnType<typeof createBuilderMcpNodeServer> | undefined;
  let uninstall: (() => void) | undefined;
  const session = vi.spyOn(input.client.auth, 'getSession').mockResolvedValue({
    data: { session: { access_token: input.token } },
    error: null,
  } as never);
  try {
    const address = verifier.server.address();
    if (!address || typeof address === 'string') throw Error('NO_VERIFIER');
    gateway = createBuilderMcpNodeServer({
      ownerAttestation: createVerifierLoopbackForwarder(address.port),
    });
    gateway.server.listen(0, '127.0.0.1');
    await once(gateway.server, 'listening');
    const gatewayAddress = gateway.server.address();
    if (!gatewayAddress || typeof gatewayAddress === 'string')
      throw Error('NO_GATEWAY');
    const attest = createVerifierAttestationClient({
      key: input.key,
      fetch: (url, init) => {
        if (
          url !== 'https://mcp.usebaci.com/internal/owner/attest' ||
          typeof init?.body !== 'string'
        )
          throw Error('INVALID_FIXTURE_REQUEST');
        const headers = new Headers(init.headers);
        headers.set('host', 'mcp.usebaci.com');
        return new Promise<Response>((resolve, reject) => {
          const req = request(
            {
              host: '127.0.0.1',
              port: gatewayAddress.port,
              path: '/internal/owner/attest',
              method: 'POST',
              headers: Object.fromEntries(headers),
            },
            (res) => {
              res.resume();
              res.on('end', () =>
                resolve(new Response(null, { status: res.statusCode }))
              );
            }
          );
          req.on('error', reject);
          req.end(init.body);
        });
      },
    });
    uninstall = installExperienceOwnerRuntime(
      createOwnerLifecycleRuntime(
        () => Promise.reject(Error('UNUSED_PREVIEW')),
        {
          attest,
          verifyCommitted: () => Promise.reject(Error('UNUSED_PUBLICATION')),
        }
      )
    );
    const response = await POST(
      new NextRequest('https://usebaci.com/api/builder-experience/approval', {
        method: 'POST',
        body: JSON.stringify({
          action: 'confirm-draft',
          approvalId: input.approvalId,
        }),
      })
    );
    expect(response.status).toBe(200);
    return await response.json();
  } finally {
    uninstall?.();
    session.mockRestore();
    await gateway?.close();
    await verifier.close();
  }
}
