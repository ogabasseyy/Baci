import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { connectorError } from '../src/lib/connector/errors';
import { CONNECTOR_SCOPES } from '../src/lib/connector/grant';

export { TOOL_REQUIREMENTS as TOOL_RESOURCES } from '../src/lib/connector/tool-requirements';

const MAX_BODY_BYTES = 1_000_000;

export const issueTokenSchema = z.strictObject({
  connection_id: z.string().min(1).max(200),
  branch_ids: z.array(z.uuid()).default([]),
  scopes: z.array(z.enum(CONNECTOR_SCOPES)).default(['orders:read']),
  merchant_wide: z.boolean().default(false),
  expires_in_seconds: z.int().min(60).max(86400).nullable().default(null),
});

export const refreshSchema = z.strictObject({
  refresh_token: z.string().min(1),
});
export const revokeSchema = z.strictObject({ grant_id: z.uuid() });

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function newOpaqueToken(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString('hex')}`;
}

export function bearerToken(request: IncomingMessage): string | null {
  const header = request.headers.authorization ?? '';
  const match = header.match(/^\s*bearer\s+(.+?)\s*$/i);
  return match?.[1]?.trim() || null;
}

export function secretsEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export async function readJsonBody(
  request: IncomingMessage
): Promise<
  { ok: true; value: unknown } | { ok: false; error: string; status: 400 | 413 }
> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      return { ok: false, error: 'Request body too large.', status: 413 };
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.trim() === '') {
    return { ok: true, value: {} };
  }
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, error: 'Malformed JSON body.', status: 400 };
  }
}

export function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): void {
  response.writeHead(status, {
    'content-type': 'application/json',
    ...headers,
  });
  response.end(`${JSON.stringify(body)}\n`);
}

export function sendUnexpectedError(response: ServerResponse): void {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  sendJson(
    response,
    500,
    connectorError('UNKNOWN_OUTCOME', 'Connector request failed.')
  );
}
