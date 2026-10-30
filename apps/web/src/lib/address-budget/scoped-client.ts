import 'server-only';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/env';
import type { AgenticJwtSigningMaterial } from '@/lib/agentic/jwt-signing-material';
import { signScopedSupabaseJwt } from '@/lib/supabase/scoped-jwt';
import {
  type AddressBudgetRequest,
  addressBudgetRequestSchema,
} from '@/schemas/address-budget-request';

interface Options {
  now?: Date;
  anonKey?: string;
  supabaseUrl?: string;
  signer?: AgenticJwtSigningMaterial;
}

/** One server-only attempt capability, with no customer claims or provider secrets. */
export function createAddressBudgetClient(
  request: AddressBudgetRequest,
  options: Options = {}
) {
  const parsed = addressBudgetRequestSchema.safeParse(request);
  if (!parsed.success) throw new Error('Invalid address budget request');
  const { provider, kind, apiKey, reservationId } = parsed.data;
  const issuedAt = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const token = signScopedSupabaseJwt(
    {
      aud: 'authenticated',
      role: 'address_budget_reserver',
      address_provider: provider,
      address_request_kind: kind,
      address_credential_hash: createHash('sha256')
        .update(apiKey)
        .digest('hex'),
      address_reservation_id: reservationId,
      iat: issuedAt,
      exp: issuedAt + 60,
    },
    options.signer
  );
  return createClient(
    options.supabaseUrl ?? getSupabaseUrl(),
    options.anonKey ?? getSupabaseAnonKey(),
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    }
  );
}
