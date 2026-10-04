import { z } from 'zod';
import { EXPO_PUBLIC_API_URL } from '@/env';
import { fetchWithTimeout } from '@/lib/fetch-with-timeout';
import { supabase } from '@/lib/supabase';
import {
  type SavingsDraft,
  savingsDraftSchema,
} from '@/schemas/customer-savings-drafts';
import { isCustomerSavingsDraftRuntimeEnabled } from './customer-savings-draft-runtime';

type Scope = { merchantId: string; userId: string };
const base = '/api/storefront/customer/savings/drafts';

async function request(
  scope: Scope,
  path: string,
  body?: Record<string, unknown>
) {
  if (!isCustomerSavingsDraftRuntimeEnabled())
    throw new Error('Local savings testing is unavailable.');
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session || data.session.user.id !== scope.userId)
    throw new Error('Your session changed. Please reopen savings.');
  const response = await fetchWithTimeout(`${EXPO_PUBLIC_API_URL}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'error',
    timeout: 15000,
  });
  if (!response.ok) {
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    const code =
      payload &&
      typeof payload === 'object' &&
      'code' in payload &&
      typeof payload.code === 'string' &&
      /^SAVINGS_DRAFT_[A-Z_]+$/.test(payload.code)
        ? payload.code
        : undefined;
    throw Object.assign(
      new Error('Unable to load or save your draft. Please try again.'),
      {
        code,
        status: response.status,
      }
    );
  }
  return response.json();
}

export const customerSavingsDrafts = {
  async list(scope: Scope, requestId?: string) {
    const query = new URLSearchParams({
      merchantId: scope.merchantId,
      ...(requestId ? { requestId } : {}),
    });
    return z
      .object({ drafts: z.array(savingsDraftSchema).max(50) })
      .parse(await request(scope, `${base}?${query}`)).drafts;
  },
  async create(
    scope: Scope,
    selection: {
      productId: string;
      variantId: string | null;
      requestId: string;
    }
  ) {
    return z.object({ draft: savingsDraftSchema }).parse(
      await request(scope, base, {
        merchantId: scope.merchantId,
        ...selection,
      })
    ).draft;
  },
  async read(scope: Scope, draftId: string) {
    const query = new URLSearchParams({
      merchantId: scope.merchantId,
      draftId,
    });
    return z
      .object({ draft: savingsDraftSchema })
      .parse(await request(scope, `${base}/policy?${query}`)).draft;
  },
  async accept(scope: Scope, draft: SavingsDraft) {
    return z.object({ draft: savingsDraftSchema }).parse(
      await request(scope, `${base}/policy`, {
        merchantId: scope.merchantId,
        draftId: draft.draftId,
        revisionId: draft.revisionId,
        termsVersion: draft.terms.version,
        termsHash: draft.terms.hash,
        accepted: true,
      })
    ).draft;
  },
};
