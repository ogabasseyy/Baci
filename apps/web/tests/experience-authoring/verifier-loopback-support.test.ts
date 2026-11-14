import { expect, it, vi } from 'vitest';
import { sendVerifierTwice } from './verifier-loopback.test-support';

it('uses the isolated owner listener for signed verifier calls and preserves replay results', async () => {
  const handler = vi.fn(async (request: Request) => {
    expect(request.url).toBe(
      'https://verifier.baci-internal.invalid/v1/attest'
    );
    expect(request.headers.get('x-baci-verifier-signature')).toBe(
      'a'.repeat(64)
    );
    expect(await request.json()).toEqual({ synthetic: true });
    return new Response(null, {
      status: handler.mock.calls.length === 1 ? 204 : 409,
    });
  });
  expect(
    await sendVerifierTwice(
      handler,
      JSON.stringify({ synthetic: true }),
      'a'.repeat(64)
    )
  ).toEqual([204, 409]);
  expect(handler).toHaveBeenCalledTimes(2);
});
