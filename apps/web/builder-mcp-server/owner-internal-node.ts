import { createServer } from 'node:http';
import type { OwnerAdmission } from './owner-admission';
import {
  createOwnerAttestationHttpHandler,
  createOwnerPreviewHttpHandler,
  createOwnerPublicVerificationHttpHandler,
} from './owner-preview-http';

/** Candidate owner transport. Binding is loopback-only; private ingress must be qualified. */
export function createOwnerInternalNodeServer(options: {
  ownerPreview?: (request: Request) => Promise<Response>;
  ownerAttestation?: (request: Request) => Promise<Response>;
  ownerPublicVerification?: (request: Request) => Promise<Response>;
  ownerPreviewAdmission?: OwnerAdmission;
  ownerAttestationAdmission?: OwnerAdmission;
  ownerPublicVerificationAdmission?: OwnerAdmission;
}) {
  if (
    !options.ownerPreview &&
    !options.ownerAttestation &&
    !options.ownerPublicVerification
  )
    throw Error('OWNER_TRANSPORT_NOT_CONFIGURED');
  if (
    (options.ownerPreview && !options.ownerPreviewAdmission) ||
    (options.ownerAttestation && !options.ownerAttestationAdmission) ||
    (options.ownerPublicVerification &&
      !options.ownerPublicVerificationAdmission)
  )
    throw Error('OWNER_ADMISSION_REQUIRED');
  const previewOwnerSlots = new Set<string>();
  const preview = options.ownerPreview
    ? createOwnerPreviewHttpHandler(options.ownerPreview, {
        admit: options.ownerPreviewAdmission,
        ownerSlots: previewOwnerSlots,
      })
    : undefined;
  const verifierOwnerSlots = new Set<string>();
  const attestation = options.ownerAttestation
    ? createOwnerAttestationHttpHandler(
        options.ownerAttestation,
        options.ownerAttestationAdmission,
        verifierOwnerSlots
      )
    : undefined;
  const publicVerification = options.ownerPublicVerification
    ? createOwnerPublicVerificationHttpHandler(
        options.ownerPublicVerification,
        options.ownerPublicVerificationAdmission,
        verifierOwnerSlots
      )
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
          : req.url === '/internal/owner/public'
            ? publicVerification
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
        server.closeIdleConnections();
        await stopped;
        await Promise.allSettled([...pending]);
      })();
      return shutdown;
    },
  };
}
