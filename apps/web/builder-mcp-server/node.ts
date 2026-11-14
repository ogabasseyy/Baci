import { createServer } from 'node:http';
import { createRemoteJWKSet } from 'jose';
import { createBuilderBackendClient } from './backend-client';
import { createBuilderMcpHttpHandler } from './http';
import { BUILDER_ISSUER } from './metadata';
import {
  createOwnerAttestationHttpHandler,
  createOwnerPreviewHttpHandler,
} from './owner-preview-http';
import type { BuilderMcpDependencies } from './registry';
import { createBuilderTransportVerifier } from './token-verifier';
/** Public JWKS + outer-token HTTPS forwarder only. No vault, database, cookies or admin client. */
export function createBuilderMcpNodeServer(
  options: {
    experience?: BuilderMcpDependencies['experience'];
    executeBuilderTool?: BuilderMcpDependencies['executeBuilderTool'];
    verifyAccessToken?: (token: string) => Promise<void>;
    ownerPreview?: (request: Request) => Promise<Response>;
    ownerAttestation?: (request: Request) => Promise<Response>;
  } = {}
) {
  const handler = createBuilderMcpHttpHandler({
    experience: options.experience,
    // The listener is loopback-only; the local proxy overwrites X-Forwarded-For.
    trustedProxies: ['127.0.0.1', '::1'],
    verifyAccessToken:
      options.verifyAccessToken ??
      createBuilderTransportVerifier(
        createRemoteJWKSet(new URL(`${BUILDER_ISSUER}/jwks`))
      ),
    executeBuilderTool:
      options.executeBuilderTool ?? createBuilderBackendClient(),
  });
  const owner = options.ownerPreview
    ? createOwnerPreviewHttpHandler(options.ownerPreview)
    : undefined;
  const attestation = options.ownerAttestation
    ? createOwnerAttestationHttpHandler(options.ownerAttestation)
    : undefined;
  const server = createServer((req, res) => {
    const selected =
      owner && req.url === '/internal/owner/preview'
        ? owner
        : attestation && req.url === '/internal/owner/attest'
          ? attestation
          : handler;
    void selected.handle(req, res).catch(() => {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'Read the operation status before retrying.',
          })
        );
      } else res.end();
    });
  });
  // This bounds receiving the request, not the time spent producing a response.
  // The owner transports and their upstream ingress have separate deadlines.
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  return {
    server,
    async close() {
      await handler.close();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (
            error &&
            'code' in error &&
            error.code !== 'ERR_SERVER_NOT_RUNNING'
          )
            reject(error);
          else resolve();
        })
      );
    },
  };
}
