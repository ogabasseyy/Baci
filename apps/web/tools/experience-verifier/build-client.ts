import { createHmac, randomBytes } from 'node:crypto';
import { request } from 'node:http';
import type { BuilderIdentity } from '@/lib/builder-connector/types';
import {
  type ExperienceContext,
  requireExperienceOwner,
} from '@/lib/experience/authorization';
import type { VerifierReceipt } from '@/lib/experience/local-build-supervisor-types';
import { hasExactVerifierEvidence } from '@/lib/experience/verifier-evidence-replay';
import { experienceBuildVerifierReceipt } from '@/schemas/experience-build-verifier';
import { BUILD_VERIFIER_CALL_TIMEOUT_MS } from './build-deadline';
import { retryVerifierBusy } from './verifier-backpressure';

/** Trusted MCP host only; the verifier target is fixed to loopback. */
export function createVerifierBuildClient(settings: {
  key: Uint8Array;
  port: number;
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
  return async (receipt: VerifierReceipt, ctx: ExperienceContext) => {
    ctx.signal?.throwIfAborted();
    const value = experienceBuildVerifierReceipt.parse(receipt);
    if (!ctx.identity || value.merchantId !== ctx.merchantId)
      throw Error('VERIFIER_UNAVAILABLE');
    await requireExperienceOwner(ctx);
    const token = await settings.resolveLinkedAccessToken(ctx.identity);
    ctx.signal?.throwIfAborted();
    if (!token || token.length > 8192 || !/^[A-Za-z0-9_.-]+$/.test(token))
      throw Error('VERIFIER_UNAVAILABLE');
    const signal = AbortSignal.any([
      AbortSignal.timeout(BUILD_VERIFIER_CALL_TIMEOUT_MS),
      ...(ctx.signal ? [ctx.signal] : []),
    ]);
    const send = () => {
      const body = JSON.stringify({
        version: 1,
        nonce: randomBytes(32).toString('hex'),
        expiresAt: Date.now() + 30000,
        accessToken: token,
        ...value,
      });
      const signature = createHmac('sha256', key)
        .update(`verifier-build/v1\n${body}`)
        .digest('hex');
      return new Promise<number>((resolve, reject) => {
        const req = request(
          {
            signal,
            host: '127.0.0.1',
            port: settings.port,
            path: '/v1/build',
            method: 'POST',
            headers: {
              host: 'verifier.baci-internal.invalid',
              'content-type': 'application/json',
              'x-baci-verifier-signature': signature,
            },
          },
          (res) => {
            res.resume();
            res.once('end', () => resolve(res.statusCode ?? 503));
            res.once('error', reject);
          }
        );
        req.once('error', reject);
        req.end(body);
      }).catch(() => 503);
    };
    const status = await retryVerifierBusy(send, 429, signal);
    if (status === 429) throw Error('VERIFIER_BUSY');
    if (status === 503 && !ctx.signal?.aborted) {
      await requireExperienceOwner(ctx);
      if (await hasExactVerifierEvidence(ctx.supabase, value, ctx.signal)) {
        await requireExperienceOwner(ctx);
        return;
      }
    }
    if (status !== 204) throw Error('VERIFIER_UNAVAILABLE');
    await requireExperienceOwner(ctx);
  };
}
