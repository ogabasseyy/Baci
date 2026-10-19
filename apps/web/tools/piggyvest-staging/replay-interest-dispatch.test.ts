import { describe, expect, it } from 'vitest';
import {
  prepareReplayInterestDispatch,
  type VerifiedInterestReplayBinding,
} from './replay-interest-dispatch';

const event = {
  eventId: 'evt-interest-001',
  eventType: 'interest-payout.success',
  eventCategory: 'interest-payout',
  customer_id: 'provider-customer-001',
  eventData: {
    id: 'provider-payout-001',
    amount: 900,
    destination_wallet: 'interest-payout-wallet-001',
    destination_wallet_balance: 900,
    destination_wallet_ledger_balance: 900,
    reference: 'interest-reference-001',
    timestamp: '2026-10-01T00:00:00.000Z',
    batch_id: 'batch-001',
    break_down: {
      gross_interest_payout: 1000,
      withholding_tax: 100,
      net_interest_payout: 900,
    },
  },
  pvb_reference: 'pvb-reference-001',
  pvb_wallet: 'accrued-interest-wallet-001',
  pvb_accrued_interest_wallet: 'accrued-interest-wallet-001',
  pvb_destination_wallet: 'interest-payout-wallet-001',
  pvb_third_party_reference: null,
} as const;

const binding: VerifiedInterestReplayBinding = {
  providerBusinessId: 'provider-business-001',
  providerCustomerId: 'provider-customer-001',
  interestSourceWalletId: 'accrued-interest-wallet-001',
  interestPayoutWalletId: 'interest-payout-wallet-001',
  canonicalGoalId: 'goal-001',
  interestEligible: true,
};

describe('interest replay dispatch preparation', () => {
  it('defers a structurally valid payout when the provider event omits business and currency evidence', () => {
    expect(prepareReplayInterestDispatch(event, binding)).toEqual({
      status: 'deferred',
      reason: 'provider-business-and-currency-unverified',
      providerPayoutId: 'provider-payout-001',
    });
  });

  it('refuses a payout whose customer does not match the trusted plan binding', () => {
    expect(
      prepareReplayInterestDispatch(event, {
        ...binding,
        providerCustomerId: 'other-customer',
      })
    ).toEqual({
      status: 'deferred',
      reason: 'customer-binding-mismatch',
      providerPayoutId: 'provider-payout-001',
    });
  });

  it('refuses a payout whose configured payout wallet differs from the receipt destination', () => {
    expect(
      prepareReplayInterestDispatch(event, {
        ...binding,
        interestPayoutWalletId: 'other-payout-wallet',
      })
    ).toEqual({
      status: 'deferred',
      reason: 'payout-wallet-binding-mismatch',
      providerPayoutId: 'provider-payout-001',
    });
  });

  it('accepts a missing optional corroborating payout wallet without treating it as a mismatch', () => {
    expect(
      prepareReplayInterestDispatch(
        {
          ...event,
          pvb_destination_wallet: null,
        },
        binding
      )
    ).toEqual({
      status: 'deferred',
      reason: 'provider-business-and-currency-unverified',
      providerPayoutId: 'provider-payout-001',
    });
  });

  it('refuses a payout whose accrued-interest source wallet is not the trusted binding', () => {
    expect(
      prepareReplayInterestDispatch(
        {
          ...event,
          pvb_accrued_interest_wallet: 'other-accrued-interest-wallet',
        },
        binding
      )
    ).toEqual({
      status: 'deferred',
      reason: 'source-wallet-binding-mismatch',
      providerPayoutId: 'provider-payout-001',
    });
  });

  it('refuses ineligible plans before any canonical ledger bridge can be attempted', () => {
    expect(
      prepareReplayInterestDispatch(event, {
        ...binding,
        interestEligible: false,
      })
    ).toEqual({
      status: 'deferred',
      reason: 'interest-eligibility-unverified',
      providerPayoutId: 'provider-payout-001',
    });
  });

  it('refuses a receipt without a trusted canonical goal', () => {
    expect(
      prepareReplayInterestDispatch(event, {
        ...binding,
        canonicalGoalId: '',
      })
    ).toEqual({
      status: 'deferred',
      reason: 'interest-eligibility-unverified',
      providerPayoutId: 'provider-payout-001',
    });
  });

  it('refuses inconsistent gross, tax, and net figures', () => {
    expect(
      prepareReplayInterestDispatch(
        {
          ...event,
          eventData: {
            ...event.eventData,
            break_down: {
              ...event.eventData.break_down,
              withholding_tax: 99,
            },
          },
        },
        binding
      )
    ).toEqual({
      status: 'deferred',
      reason: 'interest-arithmetic-inconsistent',
      providerPayoutId: 'provider-payout-001',
    });
  });
});
