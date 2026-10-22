import { createServer } from 'node:http';
import { createRemoteJWKSet } from 'jose';
import { createBuilderBackendClient } from './backend-client';
import { createBuilderMcpHttpHandler } from './http';
import { BUILDER_ISSUER } from './metadata';
import { createBuilderTransportVerifier } from './token-verifier';
/** Public JWKS + outer-token HTTPS forwarder only. No vault, database, cookies or admin client. */
export function createBuilderMcpNodeServer() {
  const handler = createBuilderMcpHttpHandler({
    verifyAccessToken: createBuilderTransportVerifier(
      createRemoteJWKSet(new URL(`${BUILDER_ISSUER}/jwks`))
    ),
    executeBuilderTool: createBuilderBackendClient(),
  });
  const server = createServer((req, res) => {
    void handler.handle(req, res).catch(() => {
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
