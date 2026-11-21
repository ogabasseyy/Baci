import { oxygenDraftWriteSchema } from '@baci/shared/oxygen';
import * as Crypto from 'expo-crypto';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { OxygenClient } from '@/services/oxygen/client';
import { OxygenClientError } from '@/services/oxygen/errors';
import { restoreCheckoutHomeAddress } from './oxygen-draft-home-prefill';
import type { OxygenFields } from './oxygen-form-utils';
export function useOxygenApplicationDraft(
  client: OxygenClient,
  workflowId: string,
  scopeKey: string,
  editing: boolean,
  prefill: OxygenFields = {}
) {
  const [fields, setFields] = useState<OxygenFields>({});
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [error, setError] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const version = useRef(0);
  const pendingWrite = useRef<
    Parameters<OxygenClient['draft']['write']>[0] | null
  >(null);
  const saveLock = useRef(false);
  const saveCompletion = useRef<Promise<void>>(Promise.resolve());
  const currentStep = useRef(step);
  currentStep.current = step;
  const generation = useRef(0);
  const fingerprint = useRef('');
  const scope = useRef(scopeKey);
  scope.current = scopeKey;
  const mounted = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scope changes and explicit retry reload the encrypted draft.
  useEffect(() => {
    let live = true;
    generation.current++;
    saveLock.current = false;
    setSaving(false);
    mounted.current = true;
    setLoaded(false);
    setFields({});
    setStep(0);
    setError(null);
    setRestoreError(null);
    version.current = 0;
    pendingWrite.current = null;
    fingerprint.current = JSON.stringify({ step: 0, fields: {} });
    // Submitted identity drafts may be minimized. OTP does not need to reread PII.
    if (!editing) {
      setLoaded(true);
      return () => {
        live = false;
        mounted.current = false;
      };
    }
    void client.draft.read(workflowId).then(
      (result) => {
        if (!live) return;
        version.current = result.version;
        if (result.draft) {
          setFields(restoreCheckoutHomeAddress(result.draft.fields, prefill));
          setStep(result.draft.step);
          fingerprint.current = JSON.stringify(result.draft);
        } else {
          // Existing drafts, including deliberately cleared values, always win.
          setFields(prefill);
          fingerprint.current = JSON.stringify({ step: 0, fields: prefill });
        }
        setLoaded(true);
      },
      () => {
        if (live)
          setRestoreError(
            'Could not restore your saved application. Try again before continuing.'
          );
      }
    );
    return () => {
      live = false;
      mounted.current = false;
    };
  }, [client, workflowId, scopeKey, attempt]);
  async function save(
    nextStep: 0 | 1 | 2,
    nextFields = fields,
    finalFlush = false
  ) {
    if (!loaded || !editing) return false;
    const startedScope = scopeKey;
    const startedGeneration = generation.current;
    // Step navigation is local. Persistence stays serialized, including a blur
    // save that may have started just before the user pressed Continue.
    currentStep.current = nextStep;
    if (mounted.current) setStep(nextStep);
    while (saveLock.current) await saveCompletion.current;
    if (
      (!mounted.current && !finalFlush) ||
      scope.current !== startedScope ||
      generation.current !== startedGeneration
    )
      return false;
    saveLock.current = true;
    let release: () => void = () => undefined;
    saveCompletion.current = new Promise<void>((resolve) => {
      release = resolve;
    });
    if (mounted.current) setSaving(true);
    const nextDraft = { step: nextStep, fields: { ...nextFields } };
    const savedFingerprint = JSON.stringify(nextDraft);
    const isCurrent = () =>
      scope.current === startedScope &&
      generation.current === startedGeneration;
    try {
      // Resolve a lost response using its original key and exact payload before
      // saving changed input. Identity data stays in memory within this scope.
      while (true) {
        const request = pendingWrite.current ?? {
          workflowId,
          version: version.current,
          idempotencyKey: Crypto.randomUUID(),
          draft: nextDraft,
        };
        if (!pendingWrite.current) {
          oxygenDraftWriteSchema.parse(request);
          pendingWrite.current = request;
        }
        const result = await client.draft.write(request);
        if (!isCurrent()) return false;
        pendingWrite.current = null;
        version.current = result.version;
        fingerprint.current = JSON.stringify(request.draft);
        if (fingerprint.current === savedFingerprint) break;
      }
      if (mounted.current) setError(null);
      return true;
    } catch (failure) {
      if (mounted.current && isCurrent()) {
        if (failure instanceof OxygenClientError && failure.status === 409) {
          setLoaded(false);
          setRestoreError(
            'This application changed elsewhere. Reload saved progress before continuing.'
          );
        } else {
          setError('Could not save your application. Try again.');
        }
      }
      return false;
    } finally {
      release();
      if (generation.current === startedGeneration) saveLock.current = false;
      if (
        mounted.current &&
        scope.current === startedScope &&
        generation.current === startedGeneration
      )
        setSaving(false);
    }
  }
  async function flush(finalFlush = false) {
    if (!loaded || !editing) return false;
    const startedScope = scopeKey;
    const startedGeneration = generation.current;
    const snapshotFields = fields;
    const snapshotStep = finalFlush ? currentStep.current : step;
    while (saveLock.current) await saveCompletion.current;
    if (
      scope.current !== startedScope ||
      generation.current !== startedGeneration ||
      currentStep.current !== snapshotStep
    )
      return false;
    if (
      pendingWrite.current === null &&
      fingerprint.current ===
        JSON.stringify({ step: snapshotStep, fields: snapshotFields })
    )
      return true;
    return save(snapshotStep, snapshotFields, finalFlush);
  }
  const latest = useRef({ client, workflowId, scopeKey, flush });
  latest.current = { client, workflowId, scopeKey, flush };
  // No typing timer: field blur, app background and navigation persist explicitly.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') void latest.current.flush();
    });
    return () => {
      subscription.remove();
      const current = latest.current;
      if (
        current.scopeKey === scopeKey &&
        current.workflowId === workflowId &&
        current.client === client
      )
        void current.flush(true);
    };
  }, [client, workflowId, scopeKey]);
  return {
    fields,
    setFields,
    step,
    save,
    error,
    restoreError,
    setError,
    loaded,
    saving,
    flush,
    reload: () => setAttempt((current) => current + 1),
  };
}
