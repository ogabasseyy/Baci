import { createHmac, randomBytes } from 'node:crypto';
import { request } from 'node:http';
import type { BuilderIdentity } from '@/lib/builder-connector/types';
import {
  type OwnerRequestContext,
  requireExperienceOwner,
} from '@/lib/experience/authorization';
import { productionOrigin } from '@/lib/experience/production-origins';
import {
  experienceCaptureVerifierOutput,
  experienceCaptureVerifierSelection,
} from '@/schemas/experience-capture-verifier';
import { retryVerifierBusy } from './verifier-backpressure';

/** Trusted builder process only; verifier destination is fixed to loopback. */
export function createVerifierCaptureClient(settings: {
  key: Uint8Array;
  port: number;
  previewOrigin: string;
  resolveLinkedAccessToken(identity: BuilderIdentity): Promise<string>;
}) {
  if (
    settings.key.length !== 32 ||
    !Number.isInteger(settings.port) ||
    settings.port < 1 ||
    settings.port > 65535
  )
    throw Error('INVALID_VERIFIER_CONFIG');
  const key = Uint8Array.from(settings.key);
  const previewOrigin = productionOrigin(settings.previewOrigin);
  return async (inputCtx: OwnerRequestContext, input: unknown) => {
    inputCtx.signal?.throwIfAborted();
    const selected = experienceCaptureVerifierSelection.parse(input);
    const ctx = await requireExperienceOwner(inputCtx);
    if (!ctx.identity) throw Error('VERIFIER_UNAVAILABLE');
    const token = await settings.resolveLinkedAccessToken(ctx.identity);
    if (!token || token.length > 8192 || !/^[A-Za-z0-9_.-]+$/.test(token))
      throw Error('VERIFIER_UNAVAILABLE');
    const signal = AbortSignal.any([
      AbortSignal.timeout(600_000),
      ...(inputCtx.signal ? [inputCtx.signal] : []),
    ]);
    const busy = Symbol('VERIFIER_BUSY');
    const send = () => {
      const body = JSON.stringify({
        version: 1,
        nonce: randomBytes(32).toString('hex'),
        expiresAt: Date.now() + 30000,
        accessToken: token,
        merchantId: ctx.merchantId,
        ...selected,
      });
      const signature = createHmac('sha256', key)
        .update(`verifier-capture/v1\n${body}`)
        .digest('hex');
      return new Promise<unknown>((resolve, reject) => {
        const req = request(
          {
            host: '127.0.0.1',
            port: settings.port,
            path: '/v1/capture',
            method: 'POST',
            signal,
            headers: {
              host: 'verifier.baci-internal.invalid',
              'content-type': 'application/json',
              'x-baci-verifier-signature': signature,
            },
          },
          (res) => {
            const chunks: Buffer[] = [];
            let size = 0;
            res.on('data', (chunk: Buffer) => {
              size += chunk.length;
              if (size > 4096) res.destroy(Error('OUTPUT_BUDGET'));
              else chunks.push(chunk);
            });
            res.once('end', () => {
              try {
                if (res.statusCode === 429) {
                  resolve(busy);
                  return;
                }
                if (res.statusCode !== 200) throw Error();
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
              } catch {
                reject(Error('VERIFIER_UNAVAILABLE'));
              }
            });
            res.once('error', reject);
          }
        );
        req.once('error', reject);
        req.end(body);
      }).catch(() => {
        throw Error('VERIFIER_UNAVAILABLE');
      });
    };
    const result = await retryVerifierBusy(send, busy, signal);
    if (result === busy) throw Error('VERIFIER_UNAVAILABLE');
    const parsed = experienceCaptureVerifierOutput.parse(result);
    const url = new URL(parsed.previewUrl);
    if (
      parsed.buildId !== selected.buildId ||
      url.origin !== previewOrigin ||
      url.pathname !== '/builder/experience/preview' ||
      url.username ||
      url.password ||
      url.hash ||
      url.searchParams.size !== 3 ||
      url.searchParams.get('merchant') !== ctx.merchantId ||
      url.searchParams.get('build') !== selected.buildId ||
      url.searchParams.get('routeId') !== selected.routeId
    )
      throw Error('VERIFIER_UNAVAILABLE');
    await requireExperienceOwner(ctx);
    return parsed;
  };
}
