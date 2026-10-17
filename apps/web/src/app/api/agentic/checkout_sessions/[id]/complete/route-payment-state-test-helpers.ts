import { NextRequest } from 'next/server';
import { vi } from 'vitest';
import { calculateCheckoutSession } from '@/lib/agentic/checkout';
import { createAgenticScopedSupabaseClient } from '@/lib/agentic/scoped-supabase';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  makeReadySession,
  validHumanConfirmation,
} from './route-complete-test-helpers';

function buildCompleteRequest({
  confirmationAmount = 500000,
  includeAuthorization = true,
  paymentData = { provider: 'paystack', token: 'confirmed-by-human' },
}: {
  confirmationAmount?: number;
  includeAuthorization?: boolean;
  paymentData?: Record<string, unknown>;
} = {}) {
  const body: Record<string, unknown> = {
    payment_data: paymentData,
    buyer: {
      email: 'buyer@example.com',
      first_name: 'Ada',
      last_name: 'Lovelace',
      phone_number: '+2348012345678',
    },
  };

  if (includeAuthorization) {
    body.completion_authorization = validHumanConfirmation(confirmationAmount);
  }

  return new NextRequest(
    'http://localhost/api/agentic/checkout_sessions/agentic_session_1/complete',
    {
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idem-1',
      },
      method: 'POST',
    }
  );
}

function mockSession(session: Record<string, unknown>) {
  const updateSpy = vi.fn();
  const readChain = {
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: session, error: null }),
  };
  readChain.eq.mockReturnValue(readChain);

  const scopedSupabase = {
    from: vi.fn((table: string) => {
      if (table === 'checkout_sessions') {
        return {
          select: vi.fn(() => readChain),
          update: updateSpy,
        };
      }
      if (table === 'orders') {
        // Finalization verifies the live order state for every
        // session, bound or not: freshly created orders in these
        // fixtures are still awaiting payment.
        const chain = {
          select: vi.fn(),
          eq: vi.fn(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { payment_status: 'unpaid', shipping_status: 'pending' },
            error: null,
          }),
        };
        chain.select.mockReturnValue(chain);
        chain.eq.mockReturnValue(chain);
        return chain;
      }

      throw new Error(`Unexpected table ${table}`);
    }),
  };
  const serviceSupabase = {
    from: vi.fn((table: string) => {
      throw new Error(`Unexpected service-role table ${table}`);
    }),
  };

  vi.mocked(createAdminClient).mockReturnValue(serviceSupabase as never);
  vi.mocked(createAgenticScopedSupabaseClient).mockReturnValue(
    scopedSupabase as never
  );

  return { updateSpy };
}

function getPaymentState(payload: unknown) {
  return getAgenticMetadataField(payload, 'payment_state');
}

function getPaymentMethod(payload: unknown) {
  return getAgenticMetadataField(payload, 'payment_method');
}

function hasFinalizationOrderId(payload: unknown) {
  return (
    typeof getAgenticMetadataField(payload, 'finalization_order_id') ===
    'string'
  );
}

function getAgenticMetadataField(payload: unknown, field: string) {
  if (!payload || typeof payload !== 'object' || !('metadata' in payload)) {
    return undefined;
  }

  const metadata = (
    payload as { metadata?: { agentic?: Record<string, unknown> } }
  ).metadata;
  return metadata?.agentic?.[field];
}

function createClaimUpdateChain() {
  const chain = {} as Record<
    'eq' | 'is' | 'not' | 'select',
    ReturnType<typeof vi.fn>
  >;
  const maybeSingle = vi.fn().mockResolvedValue({
    data: makeReadySession(),
    error: null,
  });
  chain.eq = vi.fn(() => chain);
  chain.is = vi.fn(() => chain);
  chain.not = vi.fn(() => chain);
  chain.select = vi.fn(() => ({ maybeSingle }));
  return chain;
}

function createFinalUpdateChain() {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: { session_id: 'agentic_session_1' },
    error: null,
  });
  const chain = {} as Record<
    'contains' | 'eq' | 'in' | 'is' | 'select',
    ReturnType<typeof vi.fn>
  >;
  chain.contains = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.in = vi.fn(() => chain);
  chain.is = vi.fn(() => chain);
  chain.select = vi.fn(() => ({ maybeSingle }));
  return chain;
}

function createPayOnDeliveryClaimUpdateChain() {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: { session_id: 'agentic_session_1' },
    error: null,
  });
  const chain = {} as Record<
    'eq' | 'is' | 'not' | 'select',
    ReturnType<typeof vi.fn>
  >;
  chain.eq = vi.fn(() => chain);
  chain.is = vi.fn(() => chain);
  chain.not = vi.fn(() => chain);
  chain.select = vi.fn(() => ({ maybeSingle }));
  return chain;
}

function chooseUpdateChain(payload: Record<string, unknown>) {
  if (getPaymentState(payload) === 'claiming_payment') {
    return createClaimUpdateChain();
  }

  if (
    getPaymentState(payload) === 'order_finalizing' &&
    getPaymentMethod(payload) === 'pay_on_delivery' &&
    !hasFinalizationOrderId(payload)
  ) {
    return createPayOnDeliveryClaimUpdateChain();
  }

  return createFinalUpdateChain();
}

function createSessionReadChain(
  session: Record<string, unknown> = makeReadySession()
) {
  const chain = {} as Record<'eq' | 'maybeSingle', ReturnType<typeof vi.fn>>;
  chain.eq = vi.fn(() => chain);
  chain.maybeSingle = vi.fn().mockResolvedValue({
    data: session,
    error: null,
  });
  return chain;
}

function mockSuccessfulPaymentSessionSupabase(
  session: Record<string, unknown> = makeReadySession()
) {
  const updateSpy = vi.fn((payload: Record<string, unknown>) =>
    chooseUpdateChain(payload)
  );
  const readChain = createSessionReadChain(session);

  const scopedSupabase = {
    from: vi.fn((table: string) => {
      if (table === 'checkout_sessions') {
        return {
          select: vi.fn(() => readChain),
          update: updateSpy,
        };
      }
      if (table === 'orders') {
        // Finalization verifies the live order state for every
        // session, bound or not: freshly created orders in these
        // fixtures are still awaiting payment.
        const chain = {
          select: vi.fn(),
          eq: vi.fn(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { payment_status: 'unpaid', shipping_status: 'pending' },
            error: null,
          }),
        };
        chain.select.mockReturnValue(chain);
        chain.eq.mockReturnValue(chain);
        return chain;
      }

      throw new Error(`Unexpected table ${table}`);
    }),
  };
  const serviceSupabase = {
    from: vi.fn((table: string) => {
      throw new Error(`Unexpected service-role table ${table}`);
    }),
  };

  vi.mocked(createAdminClient).mockReturnValue(serviceSupabase as never);
  vi.mocked(createAgenticScopedSupabaseClient).mockReturnValue(
    scopedSupabase as never
  );

  return {
    readChain,
    scopedSupabase,
    serviceSupabase,
    supabase: scopedSupabase,
    updateSpy,
  };
}

function mockCalculatedSession({ total = 500000 }: { total?: number } = {}) {
  vi.mocked(calculateCheckoutSession).mockResolvedValue({
    fulfillmentOptions: [],
    lineItems: [
      {
        base_amount: 500000,
        discount: 0,
        id: 'line_product-1',
        item: {
          id: 'product-1',
          product_id: 'product-1',
          quantity: 1,
          title: 'Phone',
        },
        subtotal: 500000,
        tax: 0,
        total,
      },
    ],
    messages: [],
    selectedOptionId: 'pickup_store_1',
    totals: [{ type: 'total', display_text: 'Total Due', amount: total }],
  });
}

export const paymentStateTestHelpers = {
  buildCompleteRequest,
  getPaymentState,
  mockCalculatedSession,
  mockSuccessfulPaymentSessionSupabase,
  mockSession,
  makeReadySession,
};
