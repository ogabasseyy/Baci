import { maskCustomerLoginEmailHint } from '@baci/shared/schemas';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildReceiptDeviceList,
  hashReceiptClaimToken,
  type ReceiptClaimOrderForDeviceList,
} from '@/lib/import-notifications/receipt-claim-links';
import {
  createReceiptLoginHintServiceClient,
  type ReceiptLoginHintRpcClient,
} from '@/lib/receipts/server-login-hint-client';
import { receiptClaimRouteParamsSchema } from '@/schemas/receipt-claim-route-params';
import {
  type ReceiptClaimRecord,
  receiptClaimRecordSchema,
} from '@/schemas/receipt-claim-rpc';

export interface ReceiptClaimPreview {
  claimed: boolean;
  customerName: string | null;
  devices: string[];
  documentKind: 'invoice' | 'proforma_invoice' | 'receipt' | 'unknown';
  merchantName: string;
}

export type ReceiptClaimPreviewResult =
  | { ok: true; claim: ReceiptClaimPreview }
  | { ok: false; error: string; status: 400 | 404 | 410 };

export type ReceiptClaimLoginEmailHintResult =
  | { ok: true; emailHint: string }
  | { ok: false; error: string; status: 400 | 404 | 410 };

export function parseReceiptClaimToken(token: string | undefined) {
  const parsed = receiptClaimRouteParamsSchema.safeParse({ token });
  return parsed.success ? parsed.data.token : null;
}

function isExpired(expiresAt: string) {
  const expiresAtMs = new Date(expiresAt).getTime();
  return Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now();
}

function buildClaimPreview(claim: ReceiptClaimRecord): ReceiptClaimPreview {
  const orders = claim.orders ?? [];

  return {
    claimed: Boolean(claim.claimed_at),
    customerName: claim.customer_name,
    devices: buildReceiptDeviceList(orders as ReceiptClaimOrderForDeviceList[]),
    // Legacy claims predate document_kind: surface the gap instead of
    // mislabeling a possible invoice as a receipt.
    documentKind:
      claim.document_kind === 'invoice'
        ? 'invoice'
        : claim.document_kind === 'proforma_invoice'
          ? 'proforma_invoice'
          : claim.document_kind === 'receipt'
            ? 'receipt'
            : 'unknown',
    merchantName:
      claim.merchant?.business_name ?? claim.merchant?.slug ?? 'Store',
  };
}

async function loadReceiptClaimRecord({
  supabase,
  token,
}: {
  supabase: SupabaseClient;
  token: string;
}): Promise<
  | { ok: true; claim: ReceiptClaimRecord }
  | { ok: false; error: string; status: 404 | 410 }
> {
  const { data, error } = await supabase.rpc('preview_receipt_claim', {
    p_token_hash: hashReceiptClaimToken(token),
  });

  if (error) {
    throw new Error(`Failed to load receipt claim: ${error.message}`);
  }

  if (!data) {
    return { error: 'Receipt claim link not found', ok: false, status: 404 };
  }

  // The preview RPC answers expired claims with a non-sensitive sentinel
  // (no identity or order details) so direct RPC calls past expiry reveal
  // nothing while the documented 410 contract survives.
  if (
    typeof data === 'object' &&
    data !== null &&
    (data as { expired?: unknown }).expired === true
  ) {
    return { error: 'Receipt claim link has expired', ok: false, status: 410 };
  }

  const parsedClaim = receiptClaimRecordSchema.safeParse(data);
  if (!parsedClaim.success) {
    throw new Error('Failed to load receipt claim: invalid response structure');
  }

  const claim = parsedClaim.data;

  if (isExpired(claim.expires_at)) {
    return { error: 'Receipt claim link has expired', ok: false, status: 410 };
  }

  return { claim, ok: true };
}

export async function loadReceiptClaimPreview({
  supabase,
  token,
}: {
  supabase: SupabaseClient;
  token: string;
}): Promise<ReceiptClaimPreviewResult> {
  const record = await loadReceiptClaimRecord({ supabase, token });

  if (!record.ok) {
    return record;
  }

  return { claim: buildClaimPreview(record.claim), ok: true };
}

function isMissingLoginHintFunction(
  error: { code?: string | null; message?: string | null } | null
) {
  if (!error) {
    return false;
  }

  if (error.code === 'PGRST202' || error.code === '42883') {
    return true;
  }

  const message = (error.message ?? '').toLowerCase();
  return (
    message.includes('get_receipt_claim_login_hint') &&
    (message.includes('could not find') || message.includes('does not exist'))
  );
}

export async function loadReceiptClaimLoginEmailHint({
  supabase,
  serviceSupabase,
  token,
}: {
  supabase: SupabaseClient;
  // Test seam only: production omits this so the branded service client
  // is constructed after the anon preview has validated the token, and a
  // missing service key can never turn an invalid-token request into a
  // 500 before existence/expiry are checked.
  serviceSupabase?: ReceiptLoginHintRpcClient;
  token: string;
}): Promise<ReceiptClaimLoginEmailHintResult> {
  const record = await loadReceiptClaimRecord({ supabase, token });

  if (!record.ok) {
    return record;
  }

  const hintSupabase =
    serviceSupabase ?? createReceiptLoginHintServiceClient();

  // The recipient address travels through the branded single-RPC
  // login-hint handle so the anon preview payload never carries it, and
  // only a masked hint leaves the server: an anonymous token holder learns
  // which inbox to open, never the full address. During the predeploy
  // window the function does not exist yet: fall back to the legacy preview
  // email, which the schema still tolerates.
  let rawEmail: string | null = null;
  const hintResult = await hintSupabase.rpc('get_receipt_claim_login_hint', {
    p_token_hash: hashReceiptClaimToken(token),
  });

  if (!hintResult.error) {
    rawEmail =
      typeof hintResult.data === 'string' ? hintResult.data : null;
  } else if (!isMissingLoginHintFunction(hintResult.error)) {
    throw new Error(`Failed to load receipt claim: ${hintResult.error.message}`);
  }

  return {
    emailHint: maskCustomerLoginEmailHint(
      rawEmail ?? record.claim.customer_email ?? null
    ),
    ok: true,
  };
}

export {
  type ReceiptClaimActivitySource,
  type ReceiptClaimAppDownloadTarget,
  recordReceiptClaimAppDownloadClicked,
  recordReceiptClaimClick,
  recordReceiptClaimClickBestEffort,
  recordReceiptClaimLoginStarted,
  recordReceiptClaimLoginStartedBestEffort,
} from '@/lib/import-notifications/receipt-claim-activity';
