import 'server-only';
import { createServer, type IncomingMessage } from 'node:http';
import { piggyvestRuntimeCompositionSchemas as schemas } from '@/schemas/piggyvest-runtime-composition';
import { createPiggyvestRuntimeComposition } from './runtime-composition';
import { PIGGYVEST_RUNTIME_COMPOSITION_LIMITS as limits } from './runtime-composition.constants';

function requestBody(incoming: IncomingMessage): ReadableStream<Uint8Array> {
  let cleanup: () => void = () => undefined;
  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        const data = (chunk: Buffer) => {
          incoming.pause();
          controller.enqueue(chunk);
        };
        const end = () => {
          cleanup();
          controller.close();
        };
        const error = () => {
          cleanup();
          controller.error(new Error('Request unavailable'));
        };
        cleanup = () => {
          incoming.pause();
          incoming.off('data', data);
          incoming.off('end', end);
          incoming.off('error', error);
          incoming.off('aborted', error);
        };
        incoming
          .on('data', data)
          .once('end', end)
          .once('error', error)
          .once('aborted', error);
        incoming.pause();
      },
      pull() {
        incoming.resume();
      },
      cancel() {
        cleanup();
      },
    },
    { highWaterMark: 0 }
  );
}

export async function startPiggyvestRuntimeCompositionServer(
  options: Omit<
    Parameters<typeof createPiggyvestRuntimeComposition>[0],
    'origin'
  > & { port: number }
) {
  const configuration = schemas.configuration.safeParse(options.configuration);
  const port = schemas.port.safeParse(options.port);
  if (
    !configuration.success ||
    !port.success ||
    typeof options.execute !== 'function'
  )
    throw new Error('Local savings runtime unavailable');
  createPiggyvestRuntimeComposition({
    ...options,
    configuration: configuration.data,
    origin: 'http://127.0.0.1:1024',
  });
  const controllers = new Set<AbortController>();
  let origin = '';
  let handle: ReturnType<typeof createPiggyvestRuntimeComposition>;
  const server = createServer(
    {
      maxHeaderSize: limits.maxHeaderBytes,
      requestTimeout: limits.requestTimeoutMs,
      headersTimeout: limits.requestTimeoutMs,
    },
    async (incoming, outgoing) => {
      const controller = new AbortController();
      controllers.add(controller);
      const abort = () => controller.abort();
      incoming.once('aborted', abort);
      outgoing.once('close', abort);
      let timer: ReturnType<typeof setTimeout> | undefined;
      let body: ReadableStream<Uint8Array> | undefined;
      const send = (
        status: number,
        bytes: Uint8Array,
        cookies: string[] = []
      ) => {
        if (outgoing.destroyed || outgoing.writableEnded) return;
        outgoing.writeHead(status, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          connection: 'close',
          'content-length': bytes.byteLength,
          ...(cookies.length ? { 'set-cookie': cookies } : {}),
        });
        outgoing.end(bytes);
      };
      const unavailable = (status: number) =>
        send(
          status,
          Buffer.from('{"error":"Local savings runtime unavailable"}')
        );
      try {
        if (
          incoming.socket.remoteAddress !== '127.0.0.1' ||
          incoming.headers.host !== new URL(origin).host ||
          !incoming.url?.startsWith('/') ||
          incoming.url.startsWith('//') ||
          incoming.url.includes('\\') ||
          incoming.headers.upgrade
        ) {
          unavailable(400);
          return;
        }
        if (incoming.method !== 'GET' && incoming.method !== 'POST') {
          unavailable(405);
          return;
        }
        const headers = new Headers();
        for (let index = 0; index < incoming.rawHeaders.length; index += 2)
          headers.append(
            incoming.rawHeaders[index],
            incoming.rawHeaders[index + 1]
          );
        if (incoming.method === 'POST') body = requestBody(incoming);
        const init: RequestInit & { duplex: 'half' } = {
          method: incoming.method,
          headers,
          body,
          signal: controller.signal,
          duplex: 'half',
        };
        const request = new Request(`${origin}${incoming.url}`, init);
        const deadline = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            abort();
            reject(new Error('Request unavailable'));
          }, limits.requestTimeoutMs);
        });
        const result = await Promise.race([
          (async () => {
            const response = await handle(request);
            const reader = response.body?.getReader();
            const chunks: Uint8Array[] = [];
            let length = 0;
            try {
              while (reader) {
                const chunk = await reader.read();
                if (chunk.done) break;
                length += chunk.value.byteLength;
                if (
                  length > limits.maxResponseBytes ||
                  controller.signal.aborted
                )
                  throw new Error('Response unavailable');
                chunks.push(chunk.value);
              }
            } finally {
              if (reader) void reader.cancel().catch(() => undefined);
            }
            return {
              status: response.status,
              bytes: Buffer.concat(chunks),
              cookies: response.headers.getSetCookie(),
            };
          })(),
          deadline,
        ]);
        send(result.status, result.bytes, result.cookies);
      } catch {
        unavailable(503);
      } finally {
        clearTimeout(timer);
        if (body && !body.locked) void body.cancel().catch(() => undefined);
        controllers.delete(controller);
      }
    }
  );
  server.maxHeadersCount = limits.maxHeaders;
  server.on('clientError', (_error, socket) =>
    socket.end(
      'HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'
    )
  );
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port.data, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Local savings runtime unavailable');
  }
  origin = `http://127.0.0.1:${address.port}`;
  handle = createPiggyvestRuntimeComposition({
    ...options,
    configuration: configuration.data,
    origin,
  });
  return {
    origin,
    async close(): Promise<void> {
      for (const controller of controllers) controller.abort();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}
