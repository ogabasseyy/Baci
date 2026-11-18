import type { OxygenRuntimeAction } from '@baci/shared/oxygen';
import { useRef, useState } from 'react';
import type { OxygenBank, OxygenFields } from './oxygen-form-utils';
import { oxygenIdentityErrors } from './oxygen-identity-validation';
import { prepareOxygenApplication } from './prepare-oxygen-application';
export function useOxygenApplicationSubmission({
  fields,
  banks,
  accountName,
  checking,
  consent,
  hasProof,
  checkoutPhone,
  setFieldErrors,
  setError,
  save,
  onExecute,
}: {
  fields: OxygenFields;
  banks: readonly OxygenBank[];
  accountName: string;
  checking: boolean;
  consent: boolean;
  hasProof: boolean;
  checkoutPhone: string;
  setFieldErrors: (errors: Partial<Record<keyof OxygenFields, string>>) => void;
  setError: (error: string | null) => void;
  save: (step: 0 | 1 | 2) => Promise<boolean>;
  onExecute: (command: OxygenRuntimeAction) => Promise<void>;
}) {
  const [phase, setPhase] = useState<'saving' | 'requesting' | null>(null);
  const locked = useRef(false);
  async function submit() {
    if (locked.current) return;
    const identityErrors = oxygenIdentityErrors(fields, checkoutPhone);
    setFieldErrors(identityErrors);
    if (Object.keys(identityErrors).length) {
      setError('Check the highlighted identity details.');
      await save(0);
      return;
    }
    const prepared = prepareOxygenApplication({
      fields,
      banks,
      accountName,
      checking,
      consent,
      hasProof,
      checkoutPhone,
    });
    if ('error' in prepared) {
      setError(prepared.error ?? null);
      if ('bankRequired' in prepared && prepared.bankRequired) await save(1);
      return;
    }
    locked.current = true;
    setPhase('saving');
    try {
      if (prepared.command && (await save(2))) {
        setPhase('requesting');
        await onExecute(prepared.command);
      }
    } finally {
      locked.current = false;
      setPhase(null);
    }
  }
  return {
    submit,
    label:
      phase === 'saving'
        ? 'Saving your details…'
        : phase === 'requesting'
          ? 'Requesting your code…'
          : null,
  };
}
