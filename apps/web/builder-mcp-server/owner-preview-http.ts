import type { IncomingMessage, ServerResponse } from 'node:http';

/** Fixed, bounded transport for the signed server-to-server owner preview route. */
export function createOwnerPreviewHttpHandler(
  bridge: (request: Request) => Promise<Response>
) {
  return createOwnerHttpHandler(bridge, {
    path: '/internal/owner/preview',
    target: 'https://mcp.usebaci.com/internal/owner/preview',
    signature: 'x-baci-owner-signature',
  });
}

/** The fixed verifier target is reachable only through the trusted relay. */
export function createOwnerAttestationHttpHandler(
  bridge: (request: Request) => Promise<Response>
) {
  return createOwnerHttpHandler(bridge, {
    path: '/internal/owner/attest',
    target: 'https://verifier.baci-internal.invalid/v1/attest',
    signature: 'x-baci-verifier-signature',
  });
}

function createOwnerHttpHandler(
  bridge: (request: Request) => Promise<Response>,
  binding: { path: string; target: string; signature: string }
) {
  let readers = 0;
  let active = 0;
  const respond = (res: ServerResponse, status: number) => {
    if (!res.headersSent)
      res.writeHead(status, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
    if (!res.writableEnded) res.end('{}');
  };
  async function dispatch(req: IncomingMessage, res: ServerResponse) {
    if (
      req.method !== 'POST' ||
      req.url !== binding.path ||
      req.headers.host !== 'mcp.usebaci.com' ||
      req.rawHeaders.filter(
        (_, i) => i % 2 === 0 && req.rawHeaders[i].toLowerCase() === 'host'
      ).length !== 1 ||
      req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !==
        'application/json'
    ) {
      respond(res, 404);
      return;
    }
    const signature = req.headers[binding.signature];
    if (
      typeof signature !== 'string' ||
      !/^[a-f0-9]{64}$/.test(signature) ||
      req.rawHeaders.filter(
        (_, i) =>
          i % 2 === 0 && req.rawHeaders[i].toLowerCase() === binding.signature
      ).length !== 1
    ) {
      req.resume();
      respond(res, 401);
      return;
    }
    if (readers >= 8) {
      req.resume();
      respond(res, 429);
      return;
    }
    if (
      req.headers['content-length'] &&
      /^\d+$/.test(req.headers['content-length']) &&
      Number(req.headers['content-length']) > 16384
    ) {
      req.resume();
      respond(res, 413);
      return;
    }
    readers++;
    let bytes: Buffer;
    try {
      bytes = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let done = false;
        const finish = (error?: Error) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          req.off('data', onData);
          req.off('end', onEnd);
          req.off('error', onError);
          req.off('aborted', onError);
          if (error) {
            req.resume();
            reject(error);
          } else resolve(Buffer.concat(chunks));
        };
        const onData = (chunk: Buffer) => {
          size += chunk.length;
          if (size > 16384) finish(Error('BODY_BUDGET'));
          else chunks.push(chunk);
        };
        const onEnd = () => finish();
        const onError = () => finish(Error('BODY_UNAVAILABLE'));
        const timer = setTimeout(() => finish(Error('BODY_TIMEOUT')), 10000);
        req.on('data', onData);
        req.once('end', onEnd);
        req.once('error', onError);
        req.once('aborted', onError);
      });
    } catch (error) {
      respond(
        res,
        error instanceof Error && error.message === 'BODY_BUDGET' ? 413 : 400
      );
      return;
    } finally {
      readers--;
    }
    try {
      const headers = new Headers({ 'content-type': 'application/json' });
      headers.set(binding.signature, signature);
      const result = await bridge(
        new Request(binding.target, {
          method: 'POST',
          headers,
          body: new Uint8Array(bytes),
        })
      );
      if (res.destroyed) return;
      const content: Uint8Array[] = [];
      let size = 0;
      const reader = result.body?.getReader();
      if (reader) {
        try {
          for (;;) {
            const next = await reader.read();
            if (next.done) break;
            size += next.value.byteLength;
            if (size > 262144) {
              await reader.cancel().catch(() => undefined);
              respond(res, 502);
              return;
            }
            content.push(next.value);
          }
        } finally {
          reader.releaseLock();
        }
      }
      const allowedStatuses = [
        200, 204, 400, 401, 403, 404, 409, 413, 429, 503,
      ];
      if (!allowedStatuses.includes(result.status)) {
        respond(res, 502);
        return;
      }
      res.writeHead(result.status, {
        'content-type': 'application/json',
        'cache-control': 'private, no-store',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
      });
      res.end(Buffer.concat(content));
    } catch {
      respond(res, 502);
    }
  }
  return {
    async handle(req: IncomingMessage, res: ServerResponse) {
      if (active >= 16) {
        req.resume();
        respond(res, 429);
        return;
      }
      active++;
      try {
        await dispatch(req, res);
      } finally {
        active--;
      }
    },
  };
}
