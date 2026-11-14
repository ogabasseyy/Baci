import { request as httpRequest } from 'node:http';
import { readBoundedJsonBody } from '@/lib/events/read-bounded-json-body';

/** Trusted MCP process only; the configured target cannot be selected by a request. */
export function createVerifierLoopbackForwarder(port: number) {
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw Error('INVALID_VERIFIER_PORT');
  return async (input: Request): Promise<Response> => {
    try {
      const url = new URL(input.url);
      if (
        input.method !== 'POST' ||
        url.href !== 'https://verifier.baci-internal.invalid/v1/attest'
      )
        return new Response(null, { status: 404 });
      const parsed = await readBoundedJsonBody(input, 16384);
      if (!parsed.ok) return new Response(null, { status: 400 });
      const signature = input.headers.get('x-baci-verifier-signature') ?? '';
      const status = await new Promise<number>((resolve, reject) => {
        const req = httpRequest(
          {
            host: '127.0.0.1',
            port,
            path: '/v1/attest',
            method: 'POST',
            signal: input.signal,
            headers: {
              host: 'verifier.baci-internal.invalid',
              'content-type': 'application/json',
              'x-baci-verifier-signature': signature,
            },
          },
          (res) => {
            res.resume();
            res.once('end', () => resolve(res.statusCode ?? 503));
            res.once('error', reject);
          }
        );
        req.once('error', reject);
        req.setTimeout(600000, () => req.destroy(Error('VERIFIER_TIMEOUT')));
        req.end(JSON.stringify(parsed.body));
      });
      return new Response(null, {
        status: [204, 400, 401, 403, 404, 409, 413, 429].includes(status)
          ? status
          : 503,
      });
    } catch {
      return new Response(null, { status: 503 });
    }
  };
}
