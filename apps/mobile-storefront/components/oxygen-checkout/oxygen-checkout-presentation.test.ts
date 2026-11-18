import type { OxygenRuntimeSnapshot } from '@baci/shared/oxygen';
import {
  oxygenPrebookingStep,
  oxygenRecoveryMode,
  oxygenUnfinishedPayment,
} from './oxygen-checkout-presentation';

const snapshot = (patch: Partial<OxygenRuntimeSnapshot>) =>
  ({
    executionEnabled: true,
    stage: 'booked',
    state: {
      applicationReference: 'application',
      bookingReference: 'booking',
      booking: { status: 'BOOKED' },
      kyc: { address_status: 'NOT_DONE' },
    },
    ...patch,
  }) as OxygenRuntimeSnapshot;
describe('saved native checkout presentation', () => {
  it('retires only a safe queued missing proof before requesting another file', () => {
    const s = snapshot({
      pending: {
        action: 'submit_address',
        status: 'queued',
        idempotencyKey: 'key',
      },
    });
    expect(oxygenRecoveryMode(s)).toBe('address');
    expect(
      oxygenRecoveryMode({
        ...s,
        pending: {
          action: s.pending?.action ?? '',
          idempotencyKey: 'key',
          status: 'executing',
        },
      })
    ).toBe('read');
    expect(
      oxygenRecoveryMode({
        ...s,
        pending: {
          action: s.pending?.action ?? '',
          idempotencyKey: 'key',
          status: 'indeterminate',
        },
      })
    ).toBe('read');
  });
  it('offers explicit queued phone retirement, never replay of OTP', () => {
    const s = snapshot({
      stage: 'application_required',
      state: { applicationReference: 'application' },
      pending: {
        action: 'validate_customer',
        status: 'queued',
        idempotencyKey: 'key',
      },
    });
    expect(oxygenRecoveryMode(s)).toBe('phone');
    expect(
      oxygenRecoveryMode({
        ...s,
        pending: {
          action: s.pending?.action ?? '',
          idempotencyKey: 'key',
          status: 'executing',
        },
      })
    ).toBe('read');
  });
  it('opens only setup once payment is canonically complete even with both links', () => {
    expect(
      oxygenUnfinishedPayment(
        snapshot({
          state: {
            paymentComplete: true,
            setupComplete: false,
            paymentUrl: 'https://paid.example',
            setupUrl: 'https://setup.example',
          },
        })
      )
    ).toEqual({
      url: 'https://setup.example',
      label: 'Complete repayment setup',
    });
  });
  it('does not reopen a paid surface while confirmation is pending or after setup', () => {
    expect(
      oxygenUnfinishedPayment(
        snapshot({
          state: {
            paymentComplete: true,
            setupComplete: true,
            paymentUrl: 'https://paid.example',
          },
        })
      )
    ).toBeNull();
    expect(
      oxygenUnfinishedPayment(
        snapshot({
          pending: {
            action: 'refresh_payment_setup',
            status: 'indeterminate',
            idempotencyKey: 'key',
          },
          state: { paymentUrl: 'https://pay.example' },
        })
      )
    ).toBeNull();
  });
});
describe('server prebooking stage progression', () => {
  it('does not confuse eligibility_required phone/selfie prerequisites with eligibility admission', () => {
    const phone = snapshot({
      stage: 'eligibility_required',
      state: { applicationReference: 'application', validated: false },
    });
    expect(oxygenPrebookingStep(phone)).toBe('phone');
    expect(
      oxygenPrebookingStep({
        ...phone,
        state: { ...phone.state, validated: true },
      })
    ).toBe('verification');
    expect(
      oxygenPrebookingStep({
        ...phone,
        state: {
          ...phone.state,
          validated: true,
          kyc: {
            phone_status: 'DONE',
            selfie_status: 'DONE',
            bvn_status: 'DONE',
          } as OxygenRuntimeSnapshot['state']['kyc'],
        },
      })
    ).toBe('eligibility');
  });
});
