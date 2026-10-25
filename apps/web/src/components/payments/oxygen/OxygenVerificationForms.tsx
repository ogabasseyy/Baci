'use client';
import type { FormEvent } from 'react';
import type { OxygenRuntimeAction } from '@/schemas/oxygen-runtime';
import { OxygenPhoneVerification } from './OxygenPhoneVerification';
export type SubmitOxygenForm = (
  command: OxygenRuntimeAction,
  file?: File
) => Promise<boolean>;

import {
  oxygenButtonClass as button,
  oxygenFieldClass as field,
} from './oxygen-checkout-styles';

const addressKeys = [
  'state',
  'lga',
  'city',
  'street',
  'landmark',
  'house_number',
] as const;
export function OxygenVerificationForms({
  stage,
  address,
  approvalOtpReady,
  busy,
  submit,
  validated = false,
  phoneError,
  clearPhoneError,
}: {
  stage: string;
  address: Record<string, string>;
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
      <form
        aria-label="Verify address"
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          const form = event.currentTarget;
          const values = new FormData(form);
          const input = form.elements.namedItem('document') as HTMLInputElement;
          const file = input.files?.[0];
          if (!file) return;
          const details = Object.fromEntries(
            addressKeys.map((key) => [key, String(values.get(key) ?? '')])
          ) as Record<(typeof addressKeys)[number], string>;
          form.reset();
          void submit({ action: 'submit_address', ...details }, file);
        }}
      >
        <fieldset disabled={busy} className="grid gap-4">
          <legend>Verify your residential address</legend>
          {addressKeys.map((key) => (
            <label key={key} className="grid gap-1">
              {key === 'house_number'
                ? 'House number'
                : key === 'lga'
                  ? 'LGA'
                  : key.charAt(0).toUpperCase() + key.slice(1)}
              <input
                className={field}
                name={key}
                required
                maxLength={200}
                defaultValue={address[key] ?? ''}
              />
            </label>
          ))}
          <label className="grid gap-1">
            Proof of address
            <input
              name="document"
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              required
            />
          </label>
          <p className="text-sm">
            Upload a PDF, JPG or PNG, up to 1.5 MB. Its address should match the
            details above.
          </p>
          <button className={button} type="submit">
            Submit address for verification
          </button>
        </fieldset>
      </form>
    );
  if (stage === 'eligibility_required')
    return (
      <OxygenPhoneVerification
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
