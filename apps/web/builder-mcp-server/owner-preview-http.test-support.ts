import { request } from 'node:http';
import { createOwnerPreviewHttpHandler as createProductionOwnerPreviewHttpHandler } from './owner-preview-http';

// Transport-only unit tests inject admission; production requires signature verification.
export const createOwnerPreviewHttpHandler: typeof createProductionOwnerPreviewHttpHandler =
  (bridge, options) =>
    createProductionOwnerPreviewHttpHandler(bridge, {
      admit: () => true,
      ...options,
    });

export async function send(
  port: number,
  options: {
    path?: string;
    host?: string;
    method?: string;
    body?: string;
    signature?: string | null;
    signatureHeader?: string;
    cookie?: string;
    signal?: AbortSignal;
  } = {}
) {
  return await new Promise<{
    status: number;
    body: string;
    headers: import('node:http').IncomingHttpHeaders;
  }>((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: options.path ?? '/internal/owner/preview',
        method: options.method ?? 'POST',
        signal: options.signal,
        headers: {
          host: options.host ?? 'owner.baci-internal.invalid',
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(options.body ?? '{}'),
          ...(options.signature === null
            ? {}
            : {
                [options.signatureHeader ?? 'x-baci-owner-signature']:
                  options.signature ?? 'a'.repeat(64),
              }),
          ...(options.cookie ? { cookie: options.cookie } : {}),
        },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body, headers: res.headers })
        );
      }
    );
    req.on('error', (error) =>
      reject(
        new Error(
          `request ${options.method ?? 'POST'} ${options.path ?? '/'} ${options.body?.length ?? 0}: ${error.message}`
        )
      )
    );
    req.end(options.body ?? '{}');
  });
}
