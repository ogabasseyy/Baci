'use client';
import type { FormEvent } from 'react';
import type { OxygenRuntimeAction } from '@/schemas/oxygen-runtime';
import { OxygenPhoneVerification } from './OxygenPhoneVerification';
import { OxygenResidentialForm } from './OxygenResidentialForm';
import type { ResidentialProof } from './oxygen-residential-address';
export type SubmitOxygenForm = (
  command: OxygenRuntimeAction,
  file?: File,
  onConfirmed?: () => Promise<void>
) => Promise<boolean>;

import {
  oxygenButtonClass as button,
  oxygenFieldClass as field,
} from './oxygen-checkout-styles';

export function OxygenVerificationForms({
  stage,
  workflowId,
  residentialProof,
  approvalOtpReady,
  busy,
  submit,
  validated = false,
  phoneError,
  clearPhoneError,
}: {
  stage: string;
  address: Record<string, string>;
  workflowId?: string;
  residentialProof?: ResidentialProof;
  approvalOtpReady: boolean;
  busy: boolean;
  submit: SubmitOxygenForm;
  validated?: boolean;
  phoneError?: string;
  clearPhoneError?: () => void;
}) {
  function onOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const otp = String(values.get('otp') ?? '');
    if (stage === 'approval_required') {
      const input = form.elements.namedItem('signature') as HTMLInputElement;
      const file = input.files?.[0];
      if (!file || values.get('accepted') !== 'on') return;
      form.reset();
      void submit({ action: 'approve_booking', otp, accepted: true }, file);
    } else {
      form.reset();
      void submit({ action: 'validate_customer', otp });
    }
  }
  if (stage === 'booked')
    return (
      <OxygenResidentialForm
        workflowId={workflowId}
        prepared={residentialProof}
        busy={busy}
        submit={submit}
      />
    );
  if (stage === 'eligibility_required')
    return (
      <OxygenPhoneVerification
        workflowId={workflowId}
        busy={busy}
        submit={submit}
        verified={validated}
        errorMessage={phoneError}
        clearError={clearPhoneError}
      />
    );
  const approval = stage === 'approval_required';
  if (approval && !approvalOtpReady)
    return (
      <button
        className={button}
        type="button"
        disabled={busy}
        onClick={() => void submit({ action: 'trigger_approval_otp' })}
      >
        Send approval OTP
      </button>
    );
  if (!approval) return null;
  return (
    <form
      aria-label={approval ? 'Accept loan offer' : 'Verify phone'}
      onSubmit={onOtp}
      className="grid gap-4"
    >
      <fieldset disabled={busy} className="grid gap-4">
        <button
          className={button}
          type="button"
          onClick={() =>
            void submit({
              action: approval ? 'trigger_approval_otp' : 'resend_customer_otp',
            })
          }
        >
          {approval ? 'Send a new approval OTP' : 'Resend phone OTP'}
        </button>
        <label className="grid gap-1">
          {approval ? 'Approval OTP' : 'Phone verification OTP'}
          <input
            className={field}
            name="otp"
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{4,8}"
          />
        </label>
        {approval && (
          <>
            <label className="grid gap-1">
              Signature image
              <input
                name="signature"
                type="file"
                accept="image/jpeg,image/png"
                required
              />
            </label>
            <label>
              <input type="checkbox" name="accepted" required /> I accept the
              displayed loan offer
            </label>
          </>
        )}
        <button className={button} type="submit">
          {approval ? 'Accept offer and continue' : 'Verify phone'}
        </button>
      </fieldset>
    </form>
  );
}
