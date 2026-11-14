import { createServer } from 'node:http';
import {
  createOwnerAttestationHttpHandler,
  createOwnerPreviewHttpHandler,
} from './owner-preview-http';

/** Candidate owner transport. Binding is loopback-only; private ingress must be qualified. */
export function createOwnerInternalNodeServer(options: {
  ownerPreview?: (request: Request) => Promise<Response>;
  ownerAttestation?: (request: Request) => Promise<Response>;
}) {
  if (!options.ownerPreview && !options.ownerAttestation)
    throw Error('OWNER_TRANSPORT_NOT_CONFIGURED');
  const preview = options.ownerPreview
    ? createOwnerPreviewHttpHandler(options.ownerPreview)
    : undefined;
  const attestation = options.ownerAttestation
    ? createOwnerAttestationHttpHandler(options.ownerAttestation)
    : undefined;
  let closing = false;
  let shutdown: Promise<void> | undefined;
  const pending = new Set<Promise<void>>();
  const server = createServer((req, res) => {
    if (closing) {
      req.resume();
      res.writeHead(503, { 'cache-control': 'no-store' }).end();
      return;
    }
    const selected =
      req.url === '/internal/owner/preview'
        ? preview
        : req.url === '/internal/owner/attest'
          ? attestation
          : undefined;
    if (!selected) {
      req.resume();
      res.writeHead(404, { 'cache-control': 'no-store' }).end();
      return;
    }
    const work = selected.handle(req, res).catch(() => {
      if (res.destroyed) return;
      if (!res.headersSent) res.writeHead(500, { 'cache-control': 'no-store' });
      res.end();
    });
    pending.add(work);
    void work.then(
      () => pending.delete(work),
      () => pending.delete(work)
    );
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  return {
    async listen(port: number) {
      if (!Number.isInteger(port) || port < 0 || port > 65535)
        throw Error('INVALID_OWNER_PORT');
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          server.off('error', reject);
          resolve();
        });
      });
      const address = server.address();
      if (!address || typeof address === 'string')
        throw Error('OWNER_BIND_FAILED');
      return address.port;
    },
    close() {
      shutdown ??= (async () => {
        closing = true;
        const stopped = new Promise<void>((resolve, reject) =>
          server.close((error) => {
            if (
              error &&
              (!('code' in error) || error.code !== 'ERR_SERVER_NOT_RUNNING')
            )
              reject(error);
            else resolve();
          })
        );
        server.closeAllConnections();
        await stopped;
        await Promise.allSettled([...pending]);
      })();
      return shutdown;
    },
  };
}
