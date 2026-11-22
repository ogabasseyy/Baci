import { expect, it } from 'vitest';
import {
  paidOrderCheckoutCaptureDecisionSchema,
  paystackAmendmentProviderIdSchema,
} from './order-amendment-payment';

it('validates the tracked capture outcome and optional paid surcharge', () => {
  const decision = { outcome: 'ready', customerFeeMinor: 1767 };
  expect(paidOrderCheckoutCaptureDecisionSchema.parse(decision)).toEqual(
    decision
  );
  expect(
    paidOrderCheckoutCaptureDecisionSchema.safeParse({
      ...decision,
      customerFeeMinor: -1,
    }).success
  ).toBe(false);
});

it('preserves provider IDs wider than a safe number', () => {
  const id = '9007199254740993';
  expect(paystackAmendmentProviderIdSchema.parse(id)).toBe(id);
  expect(paystackAmendmentProviderIdSchema.safeParse(Number(id)).success).toBe(
    false
  );
  expect(paystackAmendmentProviderIdSchema.safeParse('0').success).toBe(false);
});
