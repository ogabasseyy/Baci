'use client';
import { useEffect, useRef, useState } from 'react';
import type { OxygenCustomerPrefill } from '@/schemas/oxygen-customer-prefill';
import {
  OXYGEN_DRAFT_FIELDS,
  type OxygenFormDraft,
} from '@/schemas/oxygen-form-draft';
import { OxygenBankFields } from './OxygenBankFields';
import { OxygenBirthDateField } from './OxygenBirthDateField';
import { OxygenContactFields } from './OxygenContactFields';
import styles from './OxygenCustomerFormFields.module.css';
import { OxygenEmploymentAndAddress } from './OxygenEmploymentAndAddress';
import { OxygenFormProgress } from './OxygenFormProgress';
import { OxygenIdentityField } from './OxygenIdentityField';
import { OxygenLoadingButton } from './OxygenLoadingButton';
import type { SubmitOxygenForm } from './OxygenVerificationForms';
import { OxygenVerificationTrust } from './OxygenVerificationTrust';
import { parseOxygenCustomerForm } from './oxygen-customer-form-payload';
import { getOxygenFormCorrection } from './oxygen-form-correction';
import {
  type ResidentialProof,
  residentialAddress,
  residentialKeys,
} from './oxygen-residential-address';

export type CustomerFormProps = {
  prefill?: OxygenCustomerPrefill;
  workflowId?: string;
  checkoutAddress?: Record<string, string>;
  onResidentialReady?: (proof: ResidentialProof) => void;
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
  checkoutAddress = {},
  onResidentialReady,
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
  const [residentialFile, setResidentialFile] = useState<File | null>(null);
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
  const [continuing, setContinuing] = useState<'saving' | 'starting' | null>(
    null
  );
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
      onBlur={(event) => {
        capture();
        // Focus moves between inputs and Continue are covered by the debounce.
        // Flush only when focus leaves the entire form, avoiding a second save
        // immediately before the next-step snapshot is queued.
        if (!event.currentTarget.contains(event.relatedTarget))
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
        if (step < 2) {
          onProgress?.(
            step === 0 ? 'bank' : 'income',
            step === 0 ? 'identity' : 'bank'
          );
          setStep(step + 1);
          // Local navigation never submits to Oxygen. The final submit below
          // still requires durable save acknowledgement and rejects conflicts.
          void flushDraft();
          return;
        }
        continuingRef.current = true;
        setContinuing('saving');
        try {
          if (workflowId && !(await flushDraft())) return;
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
          if (onResidentialReady) {
            if (!residentialFile) {
              setFormError(
                'Attach a utility bill or proof of your home address.'
              );
              return;
            }
            onResidentialReady({
              file: residentialFile,
              address: residentialAddress(
                Object.fromEntries(
                  residentialKeys.map((key) => [
                    key,
                    String(data.get(`home_${key}`) ?? ''),
                  ])
                )
              ),
            });
          }
          setContinuing('starting');
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
          setContinuing(null);
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
        <div
          data-step="0"
          hidden={step !== 0}
          className={step === 0 ? styles.enter : undefined}
        >
          <OxygenContactFields prefill={prefill} defaults={defaults} />
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
        <div
          data-step="1"
          hidden={step !== 1}
          className={step === 1 ? styles.enter : undefined}
        >
          <OxygenBankFields
            active={step === 1}
            workflowId={workflowId}
            busy={busy}
            defaults={defaults}
          />
        </div>
        <div
          data-step="2"
          hidden={step !== 2}
          className={`space-y-4 ${step === 2 ? styles.enter : ''}`}
        >
          <OxygenEmploymentAndAddress
            defaults={defaults}
            collectAddress={Boolean(onResidentialReady)}
            checkoutAddress={checkoutAddress}
            file={residentialFile}
            onFile={setResidentialFile}
            onAddressChange={() => requestAnimationFrame(() => capture())}
          />
        </div>
        <OxygenVerificationTrust />
        <div className="flex items-center justify-between gap-3 pt-1">
          {step > 0 ? (
            <button
              type="button"
              disabled={busy || Boolean(continuing)}
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
            loading={Boolean(continuing)}
            pendingLabel={
              continuing === 'saving'
                ? 'Saving details…'
                : 'Starting verification…'
            }
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
