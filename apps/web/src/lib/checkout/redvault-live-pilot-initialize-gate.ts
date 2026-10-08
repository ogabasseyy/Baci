import type { SupabaseClient } from '@supabase/supabase-js';
import 'server-only';
import { getRedvaultCallbackUrl } from './redvault-callback-url';
import { REDVAULT_PILOT_USER_ID } from './redvault-live-pilot';
import type { RedvaultLivePilotRejection } from './redvault-live-pilot-verification';
import {
  verifyRedvaultLivePilotFunding,
  verifyRedvaultLivePilotSnapshot,
} from './redvault-live-pilot-verification';
import { getRedvaultPaymentAvailability } from './redvault-payment-availability';

// Pilot orchestration for payment initialization, extracted from the
// initialize route so the payment handler stays a thin wiring layer:
// pilot authorization, snapshot/funding verification, callback
// construction, and attempt-preservation wiring all live here. Each
// gate returns a rejection to map into the route's error response,
// or null when the request may proceed.
const UNAVAILABLE: RedvaultLivePilotRejection = {
  message: 'REDVAULT payment is not available',
  code: 'REDVAULT_UNAVAILABLE',
  status: 409,
};

export function isRedvaultLivePilotInitialize(): boolean {
  return getRedvaultPaymentAvailability().reason === 'private_live_pilot';
}

export function rejectUnauthorizedRedvaultLivePilot(input: {
  reason: string;
  userId?: string | null;
}): RedvaultLivePilotRejection | null {
  if (
    input.reason === 'private_live_pilot' &&
    input.userId !== REDVAULT_PILOT_USER_ID
  ) {
    return UNAVAILABLE;
  }
  return null;
}

export async function rejectInvalidRedvaultLivePilotSnapshot(input: {
  redvaultRequested: boolean;
  client: SupabaseClient;
  orderId: string;
  userId: string | null | undefined;
  merchantId: string;
}): Promise<RedvaultLivePilotRejection | null> {
  if (!input.redvaultRequested || !isRedvaultLivePilotInitialize()) {
    return null;
  }
  const snapshot = await verifyRedvaultLivePilotSnapshot({
    client: input.client,
    orderId: input.orderId,
    userId: input.userId,
    merchantId: input.merchantId,
  });
  return snapshot.ok ? null : snapshot.rejection;
}

export function rejectInvalidRedvaultLivePilotFunding(input: {
  redvaultRequested: boolean;
  walletAmountUsed: number;
  savingsAmountUsed: number;
}): RedvaultLivePilotRejection | null {
  if (!input.redvaultRequested || !isRedvaultLivePilotInitialize()) {
    return null;
  }
  const funding = verifyRedvaultLivePilotFunding({
    walletAmountUsed: input.walletAmountUsed,
    savingsAmountUsed: input.savingsAmountUsed,
  });
  return funding.ok ? null : funding.rejection;
}

export function buildRedvaultLivePilotCallbackUrl(input: {
  merchantSlug: string;
  protocol: 'http' | 'https';
  rootDomain: string;
}): string {
  return getRedvaultCallbackUrl({
    merchantSlug: input.merchantSlug,
    protocol: input.protocol,
    rootDomain: input.rootDomain,
    runtimeEnv: process.env.BACI_RUNTIME_ENV,
    vercelEnv: process.env.VERCEL_ENV,
    vercelUrl: process.env.VERCEL_URL,
    localBaseUrl: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    localAllowedHosts: (process.env.REDVAULT_LOCAL_CALLBACK_HOSTS ?? '')
      .split(',')
      .map((host) => host.trim())
      .filter((host) => host.length > 0),
  });
}

export function preserveRedvaultLivePilotAttempts(
  redvaultRequested: boolean
): boolean {
  return redvaultRequested && isRedvaultLivePilotInitialize();
}
