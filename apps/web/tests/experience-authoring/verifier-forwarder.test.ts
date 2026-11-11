import { expect, it, vi } from 'vitest';
import { startVerifierListener } from '../../tools/experience-verifier/listener';
import { createVerifierLoopbackForwarder } from '../../tools/experience-verifier/loopback-forwarder';

it('relays a fixed signed request only to the configured loopback verifier', async () => {
  const handler = vi.fn(async (req: Request) => {
    expect(req.headers.get('x-baci-verifier-signature')).toBe('synthetic');
    expect(req.headers.get('cookie')).toBeNull();
    expect(await req.text()).toBe('{}');
    return new Response(null, { status: 204 });
  });
  const listener = await startVerifierListener(handler, 0);
  try {
    const address = listener.server.address();
    if (!address || typeof address === 'string') throw Error('NO_LISTENER');
    const relay = createVerifierLoopbackForwarder(address.port);
    const response = await relay(
      new Request('https://verifier.baci-internal.invalid/v1/attest', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-baci-verifier-signature': 'synthetic',
          cookie: 'secret=x',
        },
        body: '{}',
      })
    );
    expect(response.status).toBe(204);
    expect(handler).toHaveBeenCalledOnce();
    expect(
      (
        await relay(
          new Request('https://evil.test/', { method: 'POST', body: '{}' })
        )
      ).status
    ).toBe(404);
  } finally {
    await listener.close();
  }
});
