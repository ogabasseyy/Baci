// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildSyntheticDvaSession,
  SYNTHETIC_DVA_ACCOUNT_NUMBER,
} from './build-synthetic-dva-session';
import { SYNTHETIC_MERCHANT_A } from './synthetic-merchants';

describe('buildSyntheticDvaSession', () => {
  it('builds a processing session for the merchant awaiting its DVA payment', () => {
    const session = buildSyntheticDvaSession(SYNTHETIC_MERCHANT_A, {
      totalAmount: 79.96,
    });

    expect(session).toMatchObject({
      currency: 'NGN',
      merchant_id: SYNTHETIC_MERCHANT_A.context.id,
      metadata: {
        agentic: {
          dva_account: { account_number: SYNTHETIC_DVA_ACCOUNT_NUMBER },
          payment_state: 'payment_pending',
        },
      },
      order_id: 'synthetic-order-1',
      status: 'processing',
      total_amount: 79.96,
    });
  });

  it('keeps an explicit missing order so the confirmation stops before writing', () => {
    const session = buildSyntheticDvaSession(SYNTHETIC_MERCHANT_A, {
      orderId: null,
      totalAmount: 79.96,
    });

    expect(session.order_id).toBeNull();
  });

  it('is identical on every build', () => {
    expect(
      buildSyntheticDvaSession(SYNTHETIC_MERCHANT_A, { totalAmount: 10 })
    ).toEqual(
      buildSyntheticDvaSession(SYNTHETIC_MERCHANT_A, { totalAmount: 10 })
    );
  });
});
