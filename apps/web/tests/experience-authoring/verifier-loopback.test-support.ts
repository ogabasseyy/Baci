import { request } from 'node:http';
import { startVerifierListener } from '../../tools/experience-verifier/listener';

export async function sendVerifierTwice(
  handler: (request: Request) => Promise<Response>,
  payload: string,
  signature: string
) {
  const listener = await startVerifierListener(handler, 0);
  try {
    const address = listener.server.address();
    if (!address || typeof address === 'string') throw Error('NO_LISTENER');
    const send = () =>
      new Promise<number>((resolve, reject) => {
        const req = request(
          {
            host: '127.0.0.1',
            port: address.port,
            path: '/v1/attest',
            method: 'POST',
            headers: {
              host: 'verifier.baci-internal.invalid',
              'content-type': 'application/json',
              'x-baci-verifier-signature': signature,
            },
          },
          (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode ?? 0));
          }
        );
        req.on('error', reject);
        req.end(payload);
      });
    return [await send(), await send()];
  } finally {
    await listener.close();
  }
}
