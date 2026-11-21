import type {
  OxygenRuntimeAction,
  OxygenRuntimeSnapshot,
  OxygenTransientFile,
} from '@baci/shared/oxygen';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import type { OxygenClient } from '@/services/oxygen/client';
import { OxygenApplicationLoading } from './OxygenApplicationLoading';
import { OxygenApplicationSteps } from './OxygenApplicationSteps';
import { OxygenButton, useOxygenColors } from './OxygenFormPrimitives';
import { OxygenPhoneVerification } from './OxygenPhoneVerification';
import type { OxygenFields } from './oxygen-form-utils';
import { oxygenIdentityErrors } from './oxygen-identity-validation';
import { useOxygenAccountConfirmation } from './use-oxygen-account-confirmation';
import { useOxygenApplicationDraft } from './use-oxygen-application-draft';
import { useOxygenApplicationSubmission } from './use-oxygen-application-submission';
import { useOxygenBanks } from './use-oxygen-banks';
import { useOxygenIdentityFeedback } from './use-oxygen-identity-feedback';
import { useOxygenProof } from './use-oxygen-proof';
export interface OxygenApplicationFlowProps {
  prefill?: OxygenFields;
  snapshot: OxygenRuntimeSnapshot;
  client: OxygenClient;
  busy: boolean;
  onExecute: (
    command: OxygenRuntimeAction,
    file?: OxygenTransientFile
  ) => Promise<void>;
  onProofControls?: (controls: {
    pick: () => Promise<void>;
    busy: boolean;
    error: string | null;
    missing: boolean;
  }) => void;
  onAddressFields?: (fields: OxygenFields) => void;
  onProof: (file: OxygenTransientFile | undefined) => void;
  scopeKey: string;
  onResendPhone?: () => Promise<void>;
  phoneSentAt?: string | null;
  onPhoneSentAt?: (time: string) => void;
  selfieRequired?: boolean;
  selfieLoading?: boolean;
  onContinueSelfie?: () => void;
  checkoutHomeAddress?: {
    kind: 'pickup' | 'delivery';
    fields: OxygenFields;
  } | null;
}
/** Mount for the workflow's full lifetime so the first booking retains its proof. */
export function OxygenApplicationFlow(props: OxygenApplicationFlowProps) {
  const { snapshot, client, busy, onExecute, scopeKey, onProof } = props;
  const colors = useOxygenColors();
  const {
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
    reload,
  } = useOxygenApplicationDraft(
    client,
    snapshot.workflowId,
    scopeKey,
    snapshot.stage === 'application_required' &&
      !snapshot.state.applicationReference,
    props.prefill
  );
  const [consent, setConsent] = useState(false);
  const {
    banks,
    error: bankError,
    retry: retryBanks,
  } = useOxygenBanks(
    client,
    snapshot.workflowId,
    snapshot.stage === 'application_required' &&
      !snapshot.state.applicationReference
  );
  const identityFeedback = useOxygenIdentityFeedback(
    fields,
    snapshot.checkoutPhone
  );
  const { setErrors: setFieldErrors } = identityFeedback;
  const bankConfirmation = useOxygenAccountConfirmation({
    client,
    workflowId: snapshot.workflowId,
    scopeKey,
    fields,
    step,
    loaded,
    active:
      snapshot.stage === 'application_required' &&
      !snapshot.state.applicationReference &&
      snapshot.executionEnabled,
  });
  const accountName = bankConfirmation.accountName;
  const onProofRef = useRef(onProof);
  onProofRef.current = onProof;
  const addressCallback = useRef(props.onAddressFields);
  addressCallback.current = props.onAddressFields;
  useEffect(() => {
    const {
      home_street,
      home_house_number,
      home_city,
      home_lga,
      home_state,
      home_landmark,
    } = fields;
    addressCallback.current?.({
      home_street,
      home_house_number,
      home_city,
      home_lga,
      home_state,
      home_landmark,
    });
  }, [fields]);
  const proofScope = JSON.stringify([
    scopeKey,
    fields.home_state,
    fields.home_lga,
    fields.home_city,
    fields.home_street,
    fields.home_house_number,
    fields.home_landmark,
  ]);
  const proof = useOxygenProof(proofScope);
  const proofControlCallback = useRef(props.onProofControls);
  proofControlCallback.current = props.onProofControls;
  const pickLatest = useRef(proof.pick);
  pickLatest.current = proof.pick;
  useEffect(() => {
    proofControlCallback.current?.({
      pick: () => pickLatest.current(),
      busy: proof.busy,
      error: proof.error,
      missing: !proof.proof,
    });
  }, [proof.busy, proof.error, proof.proof]);
  useEffect(() => {
    const file = proof.proof;
    onProofRef.current(
      file ? { bytes: file.bytes, type: file.type, name: file.name } : undefined
    );
  }, [proof.proof]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: consent and codes are never restored across scope changes.
  useEffect(() => {
    setConsent(false);
    return () => onProofRef.current(undefined);
  }, [scopeKey]);
  const proofReceived =
    snapshot.state.kyc?.address_status === 'DONE' ||
    snapshot.state.kyc?.address_status === 'PROCESSING';
  const clearProof = useRef(proof.clear);
  clearProof.current = proof.clear;
  useEffect(() => {
    if (proofReceived) clearProof.current();
  }, [proofReceived]);
  const previousApplication = useRef(snapshot.state.applicationReference);
  useEffect(() => {
    if (
      snapshot.state.applicationReference &&
      !previousApplication.current &&
      !props.phoneSentAt
    )
      props.onPhoneSentAt?.(new Date().toISOString());
    previousApplication.current = snapshot.state.applicationReference;
  }, [
    snapshot.state.applicationReference,
    props.phoneSentAt,
    props.onPhoneSentAt,
  ]);
  const submission = useOxygenApplicationSubmission({
    fields,
    banks,
    accountName,
    checking: bankConfirmation.checking,
    consent,
    hasProof: !!proof.proof,
    checkoutPhone: snapshot.checkoutPhone,
    setFieldErrors,
    setError,
    save,
    onExecute,
  });
  if (
    ['application_required', 'eligibility_required', 'kyc_required'].includes(
      snapshot.stage
    ) &&
    snapshot.state.applicationReference &&
    (!snapshot.state.validated || props.selfieRequired)
  )
    return <OxygenPhoneVerification key={scopeKey} {...props} error={error} />;
  if (
    snapshot.stage !== 'application_required' ||
    snapshot.state.applicationReference
  )
    return null;
  if (!loaded && !restoreError) return <OxygenApplicationLoading />;
  if (!loaded)
    return (
      <View style={{ gap: 16 }}>
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          {restoreError}
        </Text>
        <OxygenButton
          title="Try again"
          onPress={() => {
            reload();
          }}
          disabled={busy}
        />
      </View>
    );
  return (
    <OxygenApplicationSteps
      accountConfirmed={Boolean(accountName)}
      fields={fields}
      onChange={(patch) => setFields((current) => ({ ...current, ...patch }))}
      step={step}
      errors={identityFeedback.errors}
      onStepChange={(next) => {
        const errors =
          step === 0 && next > step
            ? oxygenIdentityErrors(fields, snapshot.checkoutPhone)
            : {};
        setFieldErrors(errors);
        if (Object.keys(errors).length) {
          setError('Check the highlighted identity details.');
          return;
        }
        setError(null);
        void save(next);
      }}
      onSubmit={() => void submission.submit()}
      submittingLabel={submission.label}
      busy={busy}
      saving={saving}
      onFieldBlur={() => {
        void flush();
      }}
      active={snapshot.executionEnabled && !snapshot.pending}
      banks={banks}
      bankError={bankError}
      onRetryBanks={retryBanks}
      onResolveAccount={bankConfirmation.resolveAccount}
      onAccountName={bankConfirmation.confirm}
      accountChecking={bankConfirmation.checking}
      consent={consent}
      onConsent={setConsent}
      proofReceived={proofReceived}
      proof={proof.proof}
      proofError={proof.error}
      proofBusy={proof.busy}
      onPickProof={(source) => {
        void proof.pick(source);
      }}
      error={identityFeedback.message(error) || bankConfirmation.error}
      checkoutAddress={props.checkoutHomeAddress}
    />
  );
}
