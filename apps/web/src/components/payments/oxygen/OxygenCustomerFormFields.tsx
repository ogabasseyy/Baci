'use client';
import { useEffect, useId, useRef, useState } from 'react';
import type { OxygenCustomerPrefill } from '@/schemas/oxygen-customer-prefill';
import type { OxygenFormDraft } from '@/schemas/oxygen-form-draft';
import { OxygenBankFields } from './OxygenBankFields';
import { OxygenBirthDateField } from './OxygenBirthDateField';
import { OxygenContactFields } from './OxygenContactFields';
import styles from './OxygenCustomerFormFields.module.css';
import { OxygenEmploymentAndAddress } from './OxygenEmploymentAndAddress';
import { OxygenFormError } from './OxygenFormError';
import { OxygenFormProgress } from './OxygenFormProgress';
import { OxygenIdentityField } from './OxygenIdentityField';
import { OxygenLoadingButton } from './OxygenLoadingButton';
import { OxygenStepHeading } from './OxygenStepHeading';
import type { SubmitOxygenForm } from './OxygenVerificationForms';
import { OxygenVerificationTrust } from './OxygenVerificationTrust';
import { oxygenCustomerDraft } from './oxygen-customer-form-draft';
import { parseOxygenCustomerForm } from './oxygen-customer-form-payload';
import { getOxygenFormCorrection } from './oxygen-form-correction';
import {
  clearOxygenControlError,
  clearOxygenFormErrors,
  firstInvalidOxygenControl,
  highlightOxygenControl,
  oxygenInvalidControlMessage,
} from './oxygen-form-invalid-field';
import {
  type ResidentialProof,
  residentialAddress,
  residentialKeys,
} from './oxygen-residential-address';
import { OXYGEN_SAVE_ERROR, useOxygenFormError } from './use-oxygen-form-error';
import { useOxygenFormErrorFocus } from './use-oxygen-form-error-focus';
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
  saveStatus,
}: CustomerFormProps & {
  initialDraft: OxygenFormDraft | null;
  saveDraft: (draft: OxygenFormDraft) => void;
  flushDraft: () => Promise<boolean>;
  saveBlocked: boolean;
  saveStatus?: string;
}) {
  const defaults = initialDraft?.fields ?? {};
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
    saveDraft(oxygenCustomerDraft(formRef.current, nextStep));
  }
  const { formError, setFormError } = useOxygenFormError(saveStatus);
  const formErrorId = useId();
  const focusInvalidField = useRef(false);
  const [continuing, setContinuing] = useState<'saving' | 'starting' | null>(
    null
  );
  const continuingRef = useRef(false);
  useOxygenFormErrorFocus(formRef, formError, focusInvalidField);
  function highlightField(input: HTMLElement) {
    focusInvalidField.current = true;
    highlightOxygenControl(input, formErrorId);
  }
  function validateSection(form: HTMLFormElement): boolean {
    focusInvalidField.current = false;
    const invalid = firstInvalidOxygenControl(form, step);
    if (invalid) {
      highlightField(invalid);
      setFormError(oxygenInvalidControlMessage(invalid));
      return false;
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
      onChange={(event) => {
        clearOxygenControlError(event.target);
        requestAnimationFrame(() => capture());
      }}
      onBlur={(event) => {
        capture();
        // Flush only when focus leaves the form to avoid a duplicate save.
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
          // Only the final submit requires durable save acknowledgement.
          void flushDraft();
          return;
        }
        continuingRef.current = true;
        setContinuing('saving');
        try {
          if (workflowId && !(await flushDraft())) {
            setFormError(OXYGEN_SAVE_ERROR);
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
          if (onResidentialReady) {
            if (!residentialFile) {
              const upload = form.querySelector<HTMLInputElement>(
                'input[type="file"][aria-label="Proof of address"]'
              );
              if (upload) highlightField(upload);
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
        <OxygenStepHeading
          step={(['identity', 'bank', 'income'] as const)[step] ?? 'identity'}
        />
        <OxygenFormError id={formErrorId} error={formError} />
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
                clearOxygenFormErrors(formRef.current, formErrorId);
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
