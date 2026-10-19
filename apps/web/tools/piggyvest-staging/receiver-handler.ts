import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const WEBHOOK_PATH = '/api/webhooks/piggyvest';
const INTAKE_URL = 'https://staging-auth.ogabassey.com/piggyvest/intake';
const MAX_BODY_BYTES = 1024 * 1024;
const INTAKE_TIMEOUT_MS = 10000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function receiverHandler(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Robots-Tag', 'noindex, nofollow');

  function reply(status: number, body: unknown) {
    response.statusCode = status;
    response.end(request.method === 'HEAD' ? undefined : JSON.stringify(body));
  }

  const expectedProject = process.env.PVB_STAGING_REGISTRATION_PROJECT_ID;
  const isStaging =
    process.env.PVB_INTEGRATION_ENV === 'staging' &&
    process.env.VERCEL_ENV === 'production' &&
    Boolean(expectedProject) &&
    process.env.VERCEL_PROJECT_ID === expectedProject;

  if (!isStaging) {
    reply(503, { error: 'Integration unavailable' });
    return;
  }
  if (request.url?.split('?')[0] !== WEBHOOK_PATH) {
    reply(404, { error: 'Not found' });
    return;
  }
  if (request.method === 'GET' || request.method === 'HEAD') {
    reply(200, {
      status: 'reachable',
      environment: 'staging',
      eventProcessing: 'quarantined',
    });
    return;
  }
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'GET, HEAD, POST');
    reply(405, { error: 'Method not allowed' });
    return;
  }

  const signature = request.headers['x-pvb-signature'];
  if (typeof signature !== 'string' || !/^[0-9a-f]{128}$/.test(signature)) {
    reply(200, { received: false, invalid: true });
    return;
  }
  const secret = process.env.PVB_SECRET_KEY;
  const ingestToken = process.env.PVB_INGEST_TOKEN;
  if (
    !secret ||
    !/^test_key_[A-Za-z0-9]+$/.test(secret) ||
    !ingestToken ||
    !/^[a-f0-9]{64}$/.test(ingestToken)
  ) {
    reply(503, { error: 'Integration unavailable' });
    return;
  }

  try {
    const chunks: Buffer[] = [];
    let size = 0;
    let oversized = false;
    for await (const chunk of request.iterator({ destroyOnReturn: false })) {
      if (!Buffer.isBuffer(chunk)) throw new Error('Invalid stream');
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        oversized = true;
        break;
      }
      chunks.push(chunk);
    }
    if (oversized) {
      request.resume();
      reply(413, { error: 'Payload too large' });
      return;
    }
    const body = Buffer.concat(chunks, size);
    const expected = createHmac('sha512', secret).update(body).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) {
      reply(200, { received: false, invalid: true });
      return;
    }

    const intake = await fetch(INTAKE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ingestToken}`,
        'content-type': 'application/octet-stream',
        'x-pvb-signature': signature,
      },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(INTAKE_TIMEOUT_MS),
    });
    if (intake.status !== 200) throw new Error('Intake unavailable');
    const receipt: unknown = await intake.json();
    if (
      typeof receipt !== 'object' ||
      receipt === null ||
      Array.isArray(receipt) ||
      !('received' in receipt) ||
      receipt.received !== true ||
      !('durable' in receipt) ||
      receipt.durable !== true ||
      !('receiptId' in receipt) ||
      typeof receipt.receiptId !== 'string' ||
      !UUID_PATTERN.test(receipt.receiptId) ||
      !('duplicate' in receipt) ||
      typeof receipt.duplicate !== 'boolean' ||
      !('processing' in receipt) ||
      receipt.processing !== 'quarantined'
    ) {
      throw new Error('Invalid receipt');
    }
    reply(200, {
      received: true,
      durable: true,
      receiptId: receipt.receiptId,
      duplicate: receipt.duplicate,
      processing: 'quarantined',
    });
  } catch {
    reply(503, { error: 'Integration unavailable' });
  }
}
