import { request } from 'node:http';
import { createOwnerInternalNodeServer } from '../../builder-mcp-server/owner-internal-node';
import { startVerifierListener } from '../../tools/experience-verifier/listener';
import { createVerifierLoopbackForwarder } from '../../tools/experience-verifier/loopback-forwarder';

export async function sendVerifierTwice(
  handler: (request: Request) => Promise<Response>,
  payload: string,
  signature: string
) {
  const listener = await startVerifierListener(handler, 0);
  let gateway: ReturnType<typeof createOwnerInternalNodeServer> | undefined;
  try {
    const address = listener.server.address();
    if (!address || typeof address === 'string') throw Error('NO_LISTENER');
    gateway = createOwnerInternalNodeServer({
      ownerAttestation: createVerifierLoopbackForwarder(address.port),
      // This helper tests replay at the verifier; signature admission is covered separately.
      ownerAttestationAdmission: (_body, _signature, reserve) =>
        reserve?.('synthetic-owner') ?? false,
    });
    const gatewayPort = await gateway.listen(0);
    const send = () =>
      new Promise<number>((resolve, reject) => {
        const req = request(
          {
            host: '127.0.0.1',
            port: gatewayPort,
            path: '/internal/owner/attest',
            method: 'POST',
            headers: {
              host: 'owner.baci-internal.invalid',
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
    await gateway?.close();
    await listener.close();
  }
}
