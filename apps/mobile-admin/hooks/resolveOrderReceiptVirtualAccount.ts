import { selectPreferredOrderPaymentAccount } from '@baci/shared';
import type { OrderDetailsRecord } from '@/components/orders/order-details.types';
import { BASE_URL } from '@/lib/api-client';
import { supabase } from '@/lib/supabase';
import { createAuthenticatedFetch } from './orders/authenticated-fetch';
import { parseGenerateDvaResponse } from './orders/parse-generate-dva-response';

const GENERATE_DVA_TIMEOUT_MS = 20_000;
const PAYSTACK_DVA_PAYMENT_STATUSES = [
  'unpaid',
  'pending',
  'partially_paid',
] as const;

interface ReceiptMerchantDetails {
  bank_account_name?: string | null;
  bank_account_number?: string | null;
  bank_code?: string | null;
  business_name?: string | null;
}

interface ResolveAccountCandidateOptions {
  allowDeviceClockSkew?: boolean;
  allowExpiredPaystackAccount?: boolean;
}

function resolveAccountCandidate(
  account:
    | {
        account_name?: string | null;
        account_number?: string | null;
        assignment_customer_email_source?: string | null;
        assigned_at?: string | null;
        bank?: string | null;
        bank_name?: string | null;
        created_at?: string | null;
        expires_at?: string | null;
        provider?: string | null;
      }
    | null
    | undefined,
  options: ResolveAccountCandidateOptions = {}
) {
  if (!account) {
    return null;
  }

  const accountNumber = account.account_number?.trim();
  if (!accountNumber) {
    return null;
  }

  const selectedAccount = selectPreferredOrderPaymentAccount(
    [
      {
        account_name: account.account_name?.trim() || null,
        account_number: accountNumber,
        assignment_customer_email_source:
          account.assignment_customer_email_source,
        assigned_at: account.assigned_at,
        bank_name: account.bank_name?.trim() || account.bank?.trim() || null,
        created_at: account.created_at,
        expires_at: account.expires_at,
        provider: account.provider,
      },
    ],
    new Date(),
    options
  );

  if (!selectedAccount) {
    return null;
  }

  return {
    account_name: selectedAccount.account_name?.trim() || '',
    account_number: selectedAccount.account_number.trim(),
    bank_name: selectedAccount.bank_name?.trim() || '',
  };
}

function canProvisionPaystackDva(order: OrderDetailsRecord) {
  const currency = (order.currency || 'NGN').trim().toUpperCase();
  return (
    currency === 'NGN' &&
    PAYSTACK_DVA_PAYMENT_STATUSES.includes(
      order.payment_status as (typeof PAYSTACK_DVA_PAYMENT_STATUSES)[number]
    ) &&
    order.shipping_status !== 'cancelled' &&
    !order.cancelled_at &&
    Boolean(order.customer_email?.trim())
  );
}

export async function resolveOrderReceiptVirtualAccount({
  order,
}: {
  /** Legacy caller field. Only customer payment accounts qualify for automatic confirmation. */
  merchant: ReceiptMerchantDetails | null | undefined;
  order: OrderDetailsRecord;
}) {
  let session = null;

  try {
    const {
      data: { session: nextSession },
    } = await supabase.auth.getSession();
    session = nextSession;
  } catch {
    // Ignore session lookup failures and continue with non-authenticated fallbacks.
  }

  if (order.payment_status === 'paid') {
    return resolveAccountCandidate(order.virtual_account, {
      allowDeviceClockSkew: true,
      allowExpiredPaystackAccount: true,
    });
  }

  const shouldProvisionPaystackDva = canProvisionPaystackDva(order);

  // Re-check Paystack accounts through the server so merchant gateway
  // disablement and the authoritative assignment window are enforced.
  let virtualAccount =
    order.virtual_account?.provider !== 'paystack'
      ? resolveAccountCandidate(order.virtual_account)
      : null;

  if (!virtualAccount && shouldProvisionPaystackDva) {
    try {
      if (session?.access_token) {
        const response = await createAuthenticatedFetch(
          `${BASE_URL}/api/orders/${order.id}/generate-dva`,
          {
            headers: {
              'Content-Type': 'application/json',
            },
            method: 'POST',
          },
          GENERATE_DVA_TIMEOUT_MS
        );

        if (response.ok) {
          const payload = parseGenerateDvaResponse(await response.json());
          virtualAccount = resolveAccountCandidate(payload?.virtualAccount);
        }
      }
    } catch {
      // Ignore invoice account provisioning failures and leave automatic confirmation unavailable.
    }
  }

  return virtualAccount;
}
