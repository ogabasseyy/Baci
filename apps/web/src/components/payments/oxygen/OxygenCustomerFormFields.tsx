'use client';
import { useEffect, useId, useRef, useState } from 'react';
import type { OxygenCustomerPrefill } from '@/schemas/oxygen-customer-prefill';
import type { OxygenFormDraft } from '@/schemas/oxygen-form-draft';
import { OxygenBankFields } from './OxygenBankFields';
import styles from './OxygenCustomerFormFields.module.css';
import { OxygenCustomerFormNavigation } from './OxygenCustomerFormNavigation';
import { OxygenEmploymentAndAddress } from './OxygenEmploymentAndAddress';
import { OxygenFormError } from './OxygenFormError';
import { OxygenFormProgress } from './OxygenFormProgress';
import { OxygenIdentityFields } from './OxygenIdentityFields';
import { OxygenStepHeading } from './OxygenStepHeading';
import type { SubmitOxygenForm } from './OxygenVerificationForms';
import { OxygenVerificationTrust } from './OxygenVerificationTrust';
import { oxygenCustomerDraft } from './oxygen-customer-form-draft';
import { parseOxygenCustomerForm } from './oxygen-customer-form-payload';
import { getOxygenFormCorrection } from './oxygen-form-correction';
import {
  clearOxygenControlError,
  clearOxygenFormErrors,
  highlightOxygenControl,
  validateOxygenSection,
} from './oxygen-form-invalid-field';
import { useOxygenCustomerTurns } from './use-oxygen-customer-turns';
import { OXYGEN_SAVE_ERROR, useOxygenFormError } from './use-oxygen-form-error';
import { useOxygenFormErrorFocus } from './use-oxygen-form-error-focus';
export type CustomerFormProps = {
  prefill?: OxygenCustomerPrefill;
  conversational?: boolean;
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
  conversational = false,
  workflowId,
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
  const turns = useOxygenCustomerTurns(initialDraft?.step ?? 0, conversational);
  const { step, turn, chatTurn, bankSelection, checkingAccount } = turns;
  // OxygenCustomerForm keys this entire form by workflow ID, resetting verification.
  const [bankVerified, setBankVerified] = useState(false);
  const [bankResolving, setBankResolving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const reportedResume = useRef(false);
  useEffect(() => {
    if (reportedResume.current) return;
    reportedResume.current = true;
    onProgress?.(step === 0 ? 'identity' : step === 1 ? 'bank' : 'income');
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
    const result = validateOxygenSection({
      form,
      step,
      turn,
      bankSelection,
      checkingAccount,
      bankVerified,
      requiresResidentialFile: false,
    });
    if (!result.ok) {
      if (result.field) highlightField(result.field);
      setFormError(result.error);
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
        if (turns.nextQuestion) {
          turns.advanceQuestion();
          capture();
          return;
        }
        const data = new FormData(form);
        capture(step < 2 ? step + 1 : step);
        if (step < 2) {
          onProgress?.(
            step === 0 ? 'bank' : 'income',
            step === 0 ? 'identity' : 'bank'
          );
          turns.goToStep(step + 1);
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
          if (data.get('consent') !== 'on') {
            const consent = form.querySelector<HTMLInputElement>(
              'input[name="consent"]'
            );
            if (consent) highlightField(consent);
            setFormError('Accept Oxygen’s terms before continuing.');
            return;
          }
          const customer = parseOxygenCustomerForm(data, phone);
          if (!customer.success) {
            const correction = getOxygenFormCorrection(customer.error.issues);
            turns.goToStep(correction.step);
            if (correction.field) {
              const selectorName =
                correction.field === 'date_of_birth'
                  ? 'birth_date_entry'
                  : correction.field;
              const target = form.querySelector<
                HTMLInputElement | HTMLSelectElement
              >(`[name="${selectorName}"]`);
              const details = target?.closest('details');
              if (details) details.open = true;
              if (target && target.type !== 'hidden') highlightField(target);
            }
            setFormError(correction.message);
            onProgress?.(
              ['identity', 'bank', 'income'][correction.step] as
                | 'identity'
                | 'bank'
                | 'income'
            );
            return;
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
        {!conversational && <OxygenFormProgress step={step} />}
        {!conversational && (
          <OxygenStepHeading
            step={(['identity', 'bank', 'income'] as const)[step] ?? 'identity'}
          />
        )}
        <OxygenFormError id={formErrorId} error={formError} />
        <div
          data-step="0"
          hidden={step !== 0}
          className={step === 0 ? styles.enter : undefined}
        >
          <OxygenIdentityFields
            conversational={conversational}
            chatTurn={chatTurn}
            prefill={prefill}
            defaults={defaults}
            onCapture={() => requestAnimationFrame(() => capture())}
          />
        </div>
        <div
          data-step="1"
          hidden={step !== 1}
          className={step === 1 ? styles.enter : undefined}
        >
          <OxygenBankFields
            active={checkingAccount || step === 2}
            conversationTurn={conversational ? chatTurn : undefined}
            onVerifiedChange={setBankVerified}
            onResolvingChange={setBankResolving}
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
            conversationTurn={conversational ? chatTurn : undefined}
          />
        </div>
        <OxygenVerificationTrust />
        <OxygenCustomerFormNavigation
          step={step}
          canGoBack={step > 0 || (conversational && chatTurn > 0)}
          busy={busy}
          continuing={continuing}
          disabled={
            busy ||
            !phone ||
            saveBlocked ||
            (checkingAccount && !bankVerified) ||
            (step === 2 && bankResolving)
          }
          continueLabel={
            turns.nextQuestion
              ? 'Continue'
              : conversational && checkingAccount
                ? 'Yes, that’s my account'
                : undefined
          }
          onBack={() => {
            clearOxygenFormErrors(formRef.current, formErrorId);
            setFormError('');
            if (!turns.back()) return;
            capture(step - 1);
            onProgress?.(step === 2 ? 'bank' : 'identity');
          }}
        />
      </fieldset>
    </form>
  );
}
