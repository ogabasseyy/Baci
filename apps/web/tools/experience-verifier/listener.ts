import { createServer, type IncomingMessage } from 'node:http';

async function readBody(req: IncomingMessage): Promise<Buffer> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      req.off('data', data);
      req.off('end', end);
      req.off('error', fail);
      req.off('aborted', fail);
      if (error) {
        req.resume();
        reject(error);
      } else resolve(Buffer.concat(chunks));
    };
    const data = (chunk: Buffer) => {
      size += chunk.length;
      if (size > 16384) finish(Error('BODY_BUDGET'));
      else chunks.push(chunk);
    };
    const end = () => finish();
    const fail = () => finish(Error('BODY_UNAVAILABLE'));
    const timer = setTimeout(() => finish(Error('BODY_TIMEOUT')), 10000);
    req.on('data', data);
    req.once('end', end);
    req.once('error', fail);
    req.once('aborted', fail);
  });
}

/** Loopback-only ingress; no public proxy should expose this listener. */
export async function startVerifierListener(
  handler: (request: Request) => Promise<Response>,
  port: number,
  buildHandler?: (request: Request) => Promise<Response>,
  captureHandler?: (request: Request) => Promise<Response>,
  publicHandler?: (request: Request) => Promise<Response>
) {
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw Error('INVALID_VERIFIER_PORT');
  let active = 0;
  let closing = false;
  let drained: (() => void) | undefined;
  const server = createServer(async (req, res) => {
    const reply = (status: number) => {
      if (!res.headersSent)
        res.writeHead(status, { 'Cache-Control': 'no-store' });
      if (!res.writableEnded) res.end();
    };
    if (
      req.method !== 'POST' ||
      (req.url !== '/v1/attest' &&
        !(req.url === '/v1/build' && buildHandler) &&
        !(req.url === '/v1/capture' && captureHandler) &&
        !(req.url === '/v1/public' && publicHandler)) ||
      req.headers.host !== 'verifier.baci-internal.invalid' ||
      req.rawHeaders.filter(
        (_, i) => i % 2 === 0 && req.rawHeaders[i].toLowerCase() === 'host'
      ).length !== 1 ||
      req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !==
        'application/json'
    ) {
      req.resume();
      reply(404);
      return;
    }
    if (closing || active >= 4) {
      req.resume();
      reply(429);
      return;
    }
    active++;
    try {
      const bytes = await readBody(req);
      const headers = new Headers({ 'content-type': 'application/json' });
      if (typeof req.headers['x-baci-verifier-signature'] === 'string')
        headers.set(
          'x-baci-verifier-signature',
          req.headers['x-baci-verifier-signature']
        );
      const selected =
        req.url === '/v1/build'
          ? buildHandler
          : req.url === '/v1/capture'
            ? captureHandler
            : req.url === '/v1/public'
              ? publicHandler
              : handler;
      if (!selected) throw Error('VERIFIER_UNAVAILABLE');
      const result = await selected(
        new Request(`https://verifier.baci-internal.invalid${req.url}`, {
          method: 'POST',
          headers,
          body: new Uint8Array(bytes),
        })
      );
      if (req.url === '/v1/capture' && result.status === 200 && result.body) {
        const reader = result.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.byteLength;
            if (size > 4096) {
              await reader.cancel();
              throw Error('OUTPUT_BUDGET');
            }
            chunks.push(part.value);
          }
        } finally {
          reader.releaseLock();
        }
        if (!res.destroyed) {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          });
          res.end(Buffer.concat(chunks));
        }
      } else {
        await result.body?.cancel();
        reply(result.status);
      }
    } catch (error) {
      reply(
        error instanceof Error && error.message === 'BODY_BUDGET' ? 413 : 403
      );
    } finally {
      active--;
      if (active === 0) drained?.();
    }
  });
  server.headersTimeout = 10000;
  server.requestTimeout = 30000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  let closePromise: Promise<void> | undefined;
  return {
    server,
    close() {
      closePromise ??= (async () => {
        closing = true;
        const pending =
          active === 0
            ? Promise.resolve()
            : new Promise<void>((resolve) => {
                drained = resolve;
              });
        const stopped = new Promise<void>((resolve, reject) =>
          server.close((error) =>
            error &&
            (!('code' in error) || error.code !== 'ERR_SERVER_NOT_RUNNING')
              ? reject(error)
              : resolve()
          )
        );
        server.closeAllConnections();
        await Promise.all([stopped, pending]);
      })();
      return closePromise;
    },
  };
}
