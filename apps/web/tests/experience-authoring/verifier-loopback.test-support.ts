import { once } from 'node:events';
import { request } from 'node:http';
import { createBuilderMcpNodeServer } from '../../builder-mcp-server/node';
import { startVerifierListener } from '../../tools/experience-verifier/listener';
import { createVerifierLoopbackForwarder } from '../../tools/experience-verifier/loopback-forwarder';

export async function sendVerifierTwice(
  handler: (request: Request) => Promise<Response>,
  payload: string,
  signature: string
) {
  const listener = await startVerifierListener(handler, 0);
  let gateway: ReturnType<typeof createBuilderMcpNodeServer> | undefined;
  try {
    const address = listener.server.address();
    if (!address || typeof address === 'string') throw Error('NO_LISTENER');
    gateway = createBuilderMcpNodeServer({
      ownerAttestation: createVerifierLoopbackForwarder(address.port),
    });
    gateway.server.listen(0, '127.0.0.1');
    await once(gateway.server, 'listening');
    const gatewayAddress = gateway.server.address();
    if (!gatewayAddress || typeof gatewayAddress === 'string')
      throw Error('NO_GATEWAY');
    const send = () =>
      new Promise<number>((resolve, reject) => {
        const req = request(
          {
            host: '127.0.0.1',
            port: gatewayAddress.port,
            path: '/internal/owner/attest',
            method: 'POST',
            headers: {
              host: 'mcp.usebaci.com',
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
