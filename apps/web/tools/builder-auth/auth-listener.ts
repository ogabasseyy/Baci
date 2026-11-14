import { once } from 'node:events';
import { chmod } from 'node:fs/promises';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { dirname, isAbsolute } from 'node:path';
import { assertPrivateDirectory } from './private-directory.ts';

export async function listenPrivateAuth(settings: {
  socketPath: string;
  issuer: string;
  provider: { proxy: boolean };
  handler(req: IncomingMessage, res: ServerResponse): Promise<void>;
}): Promise<{ close(): Promise<void> }> {
  const issuer = new URL(settings.issuer);
  if (
    issuer.protocol !== 'https:' ||
    issuer.pathname !== '/' ||
    issuer.username ||
    issuer.password ||
    issuer.search ||
    issuer.hash ||
    settings.provider.proxy
  )
    throw Error('INVALID_AUTH_INGRESS');
  settings.provider.proxy = true;
  try {
    const listener = await createAuthListener({
      socketPath: settings.socketPath,
      authority: issuer.host,
      handler: settings.handler,
    });
    return {
      async close() {
        try {
          await listener.close();
        } finally {
          settings.provider.proxy = false;
        }
      },
    };
  } catch (error) {
    settings.provider.proxy = false;
    throw error;
  }
}

/** Private same-user socket; the HTTPS ingress must not expose this socket. */
export async function createAuthListener(settings: {
  socketPath: string;
  authority: string;
  handler(req: IncomingMessage, res: ServerResponse): Promise<void>;
}): Promise<{ close(): Promise<void> }> {
  const directory = dirname(settings.socketPath);
  if (!isAbsolute(settings.socketPath))
    throw Error('UNTRUSTED_SOCKET_DIRECTORY');
  await assertPrivateDirectory(directory);
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(settings.authority))
    throw Error('INVALID_AUTHORITY');

  const server = createServer((req, res) => {
    if (req.headers.host !== settings.authority) {
      res.writeHead(400);
      res.end();
      return;
    }
    for (const name of Object.keys(req.headers)) {
      if (name === 'forwarded' || name.startsWith('x-forwarded-'))
        delete req.headers[name];
    }
    req.headers['x-forwarded-host'] = settings.authority;
    req.headers['x-forwarded-proto'] = 'https';
    void Promise.resolve()
      .then(() => settings.handler(req, res))
      .catch(() => {
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('Unable to connect. Please try again.');
        } else res.destroy();
      });
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.listen(settings.socketPath);
  await once(server, 'listening');
  try {
    await chmod(settings.socketPath, 0o600);
  } catch (error) {
    server.close();
    throw error;
  }
  return {
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (
            error &&
            (!('code' in error) || error.code !== 'ERR_SERVER_NOT_RUNNING')
          )
            reject(error);
          else resolve();
        })
      );
    },
  };
}
