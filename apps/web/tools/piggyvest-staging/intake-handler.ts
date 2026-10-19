import {
  createCipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { intakeSchema } from './intake-schema';
import { signedIntakeSchemas } from './schemas/intake-signed';

interface SealedPayload {
  payloadSha256: string;
  ciphertext: string;
  nonce: string;
  authTag: string;
  keyVersion: 'staging-v1';
  originalSignature: string;
}

interface IntakeDependencies {
  integrationToken: string;
  providerSecret: string;
  encryptionKey: Buffer;
  persist: (sealed: SealedPayload) => Promise<{
    receiptId: string;
    duplicate: boolean;
    durable: true;
    signatureStored: true;
  }>;
}

const MAX_BODY_BYTES = 1024 * 1024;
const TOKEN_PATTERN = /^[a-f\d]{64}$/i;
const SIGNATURE_PATTERN = /^[a-f\d]{128}$/i;
const UUID_PATTERN =
  /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;

function reply(
  response: ServerResponse,
  status: number,
  body: Record<string, unknown>
) {
  response.statusCode = status;
  response.end(JSON.stringify(body));
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const fail = (oversized = false) => {
      if (settled) return;
      settled = true;
      chunks.length = 0;
      request.pause();
      reject(new Error(oversized ? 'oversized' : 'stream'));
    };
    request.on('data', (chunk: unknown) => {
      if (settled) return;
      if (!Buffer.isBuffer(chunk)) return fail();
      size += chunk.length;
      if (size > MAX_BODY_BYTES) return fail(true);
      chunks.push(chunk);
    });
    request.once('error', () => fail());
    request.once('aborted', () => fail());
    request.once('close', () => fail());
    request.once('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks, size));
      chunks.length = 0;
    });
    if (request.destroyed || request.readableEnded) fail();
  });
}

export function createIntakeHandler(deps: IntakeDependencies) {
  if (
    !deps ||
    typeof deps.integrationToken !== 'string' ||
    deps.integrationToken.length !== 64 ||
    !TOKEN_PATTERN.test(deps.integrationToken) ||
    typeof deps.providerSecret !== 'string' ||
    !deps.providerSecret.trim() ||
    !Buffer.isBuffer(deps.encryptionKey) ||
    deps.encryptionKey.length !== 32 ||
    typeof deps.persist !== 'function'
  ) {
    throw new Error('Invalid intake configuration');
  }
  const token = Buffer.from(deps.integrationToken, 'ascii');
  const encryptionKey = Buffer.from(deps.encryptionKey);
  const { providerSecret, persist } = deps;

  return async (request: IncomingMessage, response: ServerResponse) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Connection', 'close');
    if (request.url !== '/piggyvest/intake') {
      return reply(response, 404, { error: 'Not found' });
    }
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      return reply(response, 405, { error: 'Method not allowed' });
    }
    const authorization = request.headers.authorization;
    const suppliedToken =
      typeof authorization === 'string' && authorization.startsWith('Bearer ')
        ? authorization.slice(7)
        : '';
    if (
      suppliedToken.length !== 64 ||
      !TOKEN_PATTERN.test(suppliedToken) ||
      !timingSafeEqual(token, Buffer.from(suppliedToken, 'ascii'))
    ) {
      return reply(response, 401, { error: 'Unauthorized' });
    }
    let raw: Buffer;
    try {
      raw = await readBody(request);
    } catch (error) {
      return reply(
        response,
        error instanceof Error && error.message === 'oversized' ? 413 : 503,
        { error: 'Intake unavailable' }
      );
    }
    const signature = request.headers['x-pvb-signature'];
    if (
      typeof signature !== 'string' ||
      signature.length !== 128 ||
      !SIGNATURE_PATTERN.test(signature) ||
      !timingSafeEqual(
        createHmac('sha512', providerSecret).update(raw).digest(),
        Buffer.from(signature, 'hex')
      )
    ) {
      return reply(response, 200, {
        received: false,
        code: 'PIGGYVEST_INVALID_SIGNATURE',
      });
    }
    try {
      const payloadSha256 = createHash('sha256').update(raw).digest('hex');
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', encryptionKey, nonce);
      cipher.setAAD(
        Buffer.from(`piggyvest-staging:staging-v1:${payloadSha256}`)
      );
      const ciphertext = Buffer.concat([cipher.update(raw), cipher.final()]);
      const sealed = intakeSchema.parse({
        payloadSha256,
        ciphertext: ciphertext.toString('base64'),
        nonce: nonce.toString('base64'),
        authTag: cipher.getAuthTag().toString('base64'),
        keyVersion: 'staging-v1',
      });
      const receipt = await persist(
        signedIntakeSchemas.sealed.parse({
          ...sealed,
          originalSignature: signature,
        })
      );
      if (
        !receipt ||
        typeof receipt.receiptId !== 'string' ||
        receipt.receiptId.length !== 36 ||
        !UUID_PATTERN.test(receipt.receiptId) ||
        typeof receipt.duplicate !== 'boolean' ||
        receipt.durable !== true ||
        receipt.signatureStored !== true
      ) {
        return reply(response, 503, { error: 'Intake unavailable' });
      }
      return reply(response, 200, {
        received: true,
        durable: true,
        receiptId: receipt.receiptId,
        duplicate: receipt.duplicate,
        processing: 'quarantined',
      });
    } catch {
      return reply(response, 503, { error: 'Intake unavailable' });
    }
  };
}
