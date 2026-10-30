import { NextResponse } from 'next/server';
import { normalizePiggyvestSignature } from '@/lib/piggyvest/verify-piggyvest-payload-signature';
import { emitPiggyvestWebhookAlert } from '@/lib/piggyvest/webhook-alerts';
import { captureVerifiedDelivery } from '@/lib/piggyvest/webhook-capture';
import { derivePiggyvestKeyVersion } from '@/lib/piggyvest/webhook-key-archive';
import {
  type PiggyvestWebhookKeyFamily,
  verifyPiggyvestWebhookSecrets,
} from '@/lib/piggyvest/webhook-secret-union';
import type { PiggyvestIntakeServiceClient } from '@/lib/supabase/service';
import type { PiggyvestCaptureResult } from '@/schemas/piggyvest/webhook-capture';

/**
 * Ingress gate of the PiggyVest receiver (R5).
 *
 * Order matters and is the whole contract:
 * 1. verify the signature over the raw bytes under a CURRENT key (a
 *    configured key, or a retired key still inside its bounded overlap);
 * 2. durably store the exact request before anything else happens;
 * 3. only then may the caller process and answer 200.
 *
 * Failures are distinct and never confused:
 * - no usable server key configuration -> 503 + alert (retryable: the
 *   provider keeps retrying while operators fix configuration);
 * - invalid signature, or a key revoked at ingress -> 401 + alert;
 * - storage failure -> 503 + alert, with no partial row (the capture is a
 *   single atomic statement).
 *
 * The service-client factory is injected by the route (see
 * quarantine-and-ack.ts for why this module must not import it).
 */

const noStore = { 'Cache-Control': 'no-store' };

export interface AdmittedDelivery {
  matchedSecret: string;
  families: readonly PiggyvestWebhookKeyFamily[];
  /** Canonical lowercase hex signature that verified. */
  signature: string;
  capture: PiggyvestCaptureResult;
}

export type AdmitResult =
  | { kind: 'rejected'; response: Response }
  | { kind: 'admitted'; delivery: AdmittedDelivery };

function reject(body: Record<string, unknown>, status: number): AdmitResult {
  return {
    kind: 'rejected',
    response: NextResponse.json(body, { status, headers: noStore }),
  };
}

export async function admitPiggyvestDelivery(input: {
  request: Pick<Request, 'headers'>;
  rawBody: Buffer;
  createClient: () => PiggyvestIntakeServiceClient;
}): Promise<AdmitResult> {
  const signatureHeader = input.request.headers.get('x-pvb-signature');
  const verification = verifyPiggyvestWebhookSecrets({
    rawBody: input.rawBody,
    signature: signatureHeader,
  });

  if (verification.status === 'unconfigured') {
    emitPiggyvestWebhookAlert('PIGGYVEST_WEBHOOK_KEYS_UNCONFIGURED', {
      reason: 'no usable current webhook key configuration',
    });
    return reject(
      { error: 'Integration unavailable', code: 'PIGGYVEST_NOT_READY' },
      503
    );
  }
  if (verification.status === 'invalid' || verification.status === 'revoked') {
    // Monitoring surface: a silent rejection would hide both a
    // provider-side signing outage and an active forgery campaign from the
    // log drain alerts key on. Presence only: never the signature value or
    // body bytes. Both outcomes share one external answer so a caller
    // cannot probe which keys were once valid; the alert tells them apart.
    console.warn(
      `[PiggyVest Webhook] Rejected delivery with invalid signature (signature header ${signatureHeader === null ? 'absent' : 'present'})`
    );
    if (verification.status === 'revoked') {
      emitPiggyvestWebhookAlert('PIGGYVEST_WEBHOOK_KEY_REVOKED', {
        keyVersion: verification.keyVersion,
        reason: 'signed with a key revoked at ingress',
      });
    }
    return reject(
      { received: false, code: 'PIGGYVEST_INVALID_SIGNATURE' },
      401
    );
  }

  const signature = normalizePiggyvestSignature(signatureHeader);
  if (!signature) {
    // Unreachable for a verified delivery; fail closed rather than store
    // evidence whose signature we cannot reproduce.
    return reject(
      { received: false, code: 'PIGGYVEST_INVALID_SIGNATURE' },
      401
    );
  }
  try {
    const capture = await captureVerifiedDelivery(input.createClient(), {
      rawBody: input.rawBody,
      headers: input.request.headers,
      signature,
      keyVersion:
        verification.keyVersion ??
        derivePiggyvestKeyVersion(verification.secret),
      keyFamilies: verification.families,
      keyStatus: verification.keyStatus ?? 'current',
    });
    return {
      kind: 'admitted',
      delivery: {
        matchedSecret: verification.secret,
        families: verification.families,
        signature,
        capture,
      },
    };
  } catch {
    emitPiggyvestWebhookAlert('PIGGYVEST_WEBHOOK_CAPTURE_FAILED', {
      reason: 'durable capture write failed; provider will redeliver',
    });
    // Never leak storage internals; 503 asks the provider to redeliver
    // while the original request is still in its retry window.
    return reject(
      {
        error: 'Event intake unavailable',
        code: 'PIGGYVEST_CAPTURE_UNAVAILABLE',
      },
      503
    );
  }
}
