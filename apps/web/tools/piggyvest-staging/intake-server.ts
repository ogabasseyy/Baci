import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { parseIntakeConfig } from './intake-config';
import { createIntakeHandler } from './intake-handler';
import { createIntakePersistence } from './intake-persist';

export function createStagingIntakeServer(
  input: unknown,
  fetcher: typeof fetch = fetch
) {
  const config = parseIntakeConfig(input);
  const handler = createIntakeHandler({
    integrationToken: config.integrationToken,
    providerSecret: config.providerSecret,
    encryptionKey: config.encryptionKey,
    persist: createIntakePersistence(config.restToken, fetcher),
  });
  const server = createServer({ maxHeaderSize: 8192 }, (request, response) => {
    void handler(request, response).catch(() => {
      if (!response.headersSent)
        response.writeHead(503, { 'Content-Type': 'application/json' });
      response.end('{"received":false,"code":"PIGGYVEST_INTAKE_UNAVAILABLE"}');
    });
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxRequestsPerSocket = 50;
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const server = createStagingIntakeServer(
      JSON.parse(readFileSync('/run/pvb-intake/config.json', 'utf8'))
    );
    server.on('error', () => process.exit(1));
    server.listen(4791, '0.0.0.0');
    process.on('SIGTERM', () => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(1), 10000).unref();
    });
  } catch {
    process.stderr.write('Staging intake startup failed\n');
    process.exitCode = 1;
  }
}
