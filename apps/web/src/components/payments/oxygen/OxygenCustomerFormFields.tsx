'use client';
import { useEffect, useRef, useState } from 'react';
import type { OxygenCustomerPrefill } from '@/schemas/oxygen-customer-prefill';
import {
  OXYGEN_DRAFT_FIELDS,
  type OxygenFormDraft,
} from '@/schemas/oxygen-form-draft';
import { OxygenBankFields } from './OxygenBankFields';
import { OxygenBirthDateField } from './OxygenBirthDateField';
import { OxygenEmploymentFields } from './OxygenEmploymentFields';
import { OxygenFormProgress } from './OxygenFormProgress';
import { OxygenIdentityField } from './OxygenIdentityField';
import { OxygenLoadingButton } from './OxygenLoadingButton';
import type { SubmitOxygenForm } from './OxygenVerificationForms';
import { OxygenVerificationTrust } from './OxygenVerificationTrust';
import { oxygenFieldClass as field } from './oxygen-checkout-styles';
import {
  parseOxygenCustomerForm,
  oxygenPersonalFields as personal,
} from './oxygen-customer-form-payload';
import { getOxygenFormCorrection } from './oxygen-form-correction';

export type CustomerFormProps = {
  prefill?: OxygenCustomerPrefill;
  workflowId?: string;
  busy: boolean;
  phone: string;
  submit: SubmitOxygenForm;
  onProgress?: (
    stage: 'identity' | 'bank' | 'income',
    completed?: 'identity' | 'bank'
  ) => void;
};

export function CustomerFormFields({
  busy,
  phone,
  submit,
  prefill = {},
  workflowId,
  onProgress,
  initialDraft,
  saveDraft,
  flushDraft,
  saveBlocked,
}: CustomerFormProps & {
  initialDraft: OxygenFormDraft | null;
  saveDraft: (draft: OxygenFormDraft) => void;
  flushDraft: () => Promise<boolean>;
  saveBlocked: boolean;
}) {
  const defaults = initialDraft?.fields ?? {};
  // Restored bank details must be resolved again before continuing to income.
  const [step, setStep] = useState(Math.min(initialDraft?.step ?? 0, 1));
  const formRef = useRef<HTMLFormElement>(null);
  const reportedResume = useRef(false);
  useEffect(() => {
    if (reportedResume.current) return;
    reportedResume.current = true;
    onProgress?.(step === 0 ? 'identity' : 'bank');
  }, [onProgress, step]);
  function capture(nextStep = step) {
    if (!formRef.current) return;
    const data = new FormData(formRef.current);
    saveDraft({
      step: nextStep as 0 | 1 | 2,
      fields: Object.fromEntries(
        OXYGEN_DRAFT_FIELDS.map((name) => [name, String(data.get(name) ?? '')])
      ),
    });
  }
  const [formError, setFormError] = useState('');
  const [continuing, setContinuing] = useState(false);
  const continuingRef = useRef(false);
  useEffect(() => {
    if (formError)
      formRef.current?.querySelector<HTMLElement>('[role=alert]')?.focus();
  }, [formError]);
  const titles = [
    'Verify your identity',
    'Verify your bank account',
    'Employment and consent',
  ];
  function validateSection(form: HTMLFormElement): boolean {
    const controls = form.querySelectorAll<
      HTMLInputElement | HTMLSelectElement
    >(`[data-step="${step}"] input, [data-step="${step}"] select`);
    for (const input of controls) {
      if (!input.checkValidity()) {
        setFormError('Please complete the required fields in this step.');
        input.reportValidity();
        return false;
      }
    }
    if (step === 1 && !String(new FormData(form).get('account_name') ?? '')) {
      setFormError('Verify your bank account before continuing.');
      return false;
    }
    setFormError('');
    return true;
  }
  return (
    <form
      ref={formRef}
      onChange={() => requestAnimationFrame(() => capture())}
      onBlur={() => {
        capture();
        void flushDraft();
      }}
      aria-label="Oxygen customer details"
      noValidate
      className="grid gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || saveBlocked || continuingRef.current) return;
        const form = event.currentTarget;
        if (!validateSection(form)) return;
        const data = new FormData(form);
        capture(step < 2 ? step + 1 : step);
        continuingRef.current = true;
        setContinuing(true);
        try {
          if (workflowId && !(await flushDraft())) return;
          if (step < 2) {
            onProgress?.(
              step === 0 ? 'bank' : 'income',
              step === 0 ? 'identity' : 'bank'
            );
            setStep(step + 1);
            return;
          }
          if (data.get('consent') !== 'on') return;
          const customer = parseOxygenCustomerForm(data, phone);
          if (!customer.success) {
            const correction = getOxygenFormCorrection(customer.error.issues);
            setStep(correction.step);
            setFormError(correction.message);
            onProgress?.(
              ['identity', 'bank', 'income'][correction.step] as
                | 'identity'
                | 'bank'
                | 'income'
            );
            return;
          }
          await submit({
            action: 'start_application',
            customer: customer.data,
          });
        } catch {
          setFormError(
            'We could not confirm this step. Check your application status before trying again.'
          );
        } finally {
          continuingRef.current = false;
          setContinuing(false);
        }
      }}
    >
      <fieldset disabled={busy} className="grid min-w-0 gap-5">
        <legend className="sr-only">Customer verification</legend>
        <OxygenFormProgress step={step} />
        <h3 className="text-lg font-bold text-gray-900">{titles[step]}</h3>
        {formError && (
          <p
            role="alert"
            tabIndex={-1}
            className="rounded-xl bg-red-50 p-3 text-sm text-red-700"
          >
            {formError}
          </p>
        )}
        <div data-step="0" hidden={step !== 0}>
          <details
            open={!prefill.first_name || !prefill.last_name || !prefill.email}
            className="mb-5"
          >
            <summary className="cursor-pointer text-xs font-medium text-gray-500 underline underline-offset-4">
              {prefill.first_name && prefill.last_name && prefill.email
                ? 'Edit name and email'
                : 'Your contact details'}
            </summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {personal
                .filter(
                  ([key]) => !['bvn', 'nin', 'date_of_birth'].includes(key)
                )
                .map(([key, label]) => (
                  <label
                    key={key}
                    className="grid gap-1.5 text-xs font-bold text-gray-700"
                  >
                    {label}
                    <input
                      className={field}
                      name={key}
                      defaultValue={
                        defaults[key] ??
                        prefill[key as keyof OxygenCustomerPrefill] ??
                        ''
                      }
                      type={key === 'email' ? 'email' : 'text'}
                      required={key !== 'middle_name'}
                      maxLength={100}
                      autoComplete="off"
                    />
                  </label>
                ))}
            </div>
          </details>
          <div className="grid gap-4 sm:grid-cols-2">
            <OxygenIdentityField
              name="bvn"
              label="BVN"
              defaultValue={defaults.bvn}
            />
            <OxygenIdentityField
              name="nin"
              label="NIN"
              defaultValue={defaults.nin}
            />
            <OxygenBirthDateField
              defaultValue={defaults.date_of_birth ?? prefill.date_of_birth}
              defaultEntry={defaults.birth_date_entry}
              onValueChange={() => requestAnimationFrame(() => capture())}
            />
          </div>
        </div>
        <div data-step="1" hidden={step !== 1}>
          <OxygenBankFields
            active={step === 1}
            workflowId={workflowId}
            busy={busy}
            defaults={defaults}
          />
        </div>
        <div data-step="2" hidden={step !== 2} className="space-y-4">
          <OxygenEmploymentFields defaults={defaults} />
          <label className="flex items-start gap-3 rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-gray-600">
            <input
              name="consent"
              type="checkbox"
              required
              className="mt-1 size-4 shrink-0 accent-store-primary"
            />
            <span>
              I agree to share these details with Oxygen for this finance
              application and accept{' '}
              <a
                href="https://www.oxygenx.africa/terms-of-service"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-store-primary underline decoration-store-primary/50 underline-offset-2 hover:decoration-store-primary focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-store-primary"
              >
                Oxygen’s terms
              </a>
              .
            </span>
          </label>
        </div>
        <OxygenVerificationTrust />
        <div className="flex items-center justify-between gap-3 pt-1">
          {step > 0 ? (
            <button
              type="button"
              disabled={busy || continuing}
              className="min-h-11 rounded-xl border border-gray-200 px-5 text-sm font-semibold text-gray-600"
              onClick={() => {
                setFormError('');
                capture(step - 1);
                setStep(step - 1);
                onProgress?.(step === 2 ? 'bank' : 'identity');
              }}
            >
              Back
            </button>
          ) : (
            <span className="hidden sm:block" />
          )}
          <OxygenLoadingButton
            className="flex-1 sm:flex-none"
            loading={continuing}
            pendingLabel={step === 2 ? 'Starting verification…' : 'Continuing…'}
            disabled={busy || !phone || saveBlocked}
            type="submit"
          >
            {step === 0
              ? 'Continue to bank details'
              : step === 1
                ? 'Continue to income details'
                : 'Continue verification'}
          </OxygenLoadingButton>
        </div>
      </fieldset>
    </form>
  );
}
