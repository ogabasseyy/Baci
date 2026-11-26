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
export interface OxygenApplicationFlowProps {
  prefill?: OxygenFields;
  snapshot: OxygenRuntimeSnapshot;
  client: OxygenClient;
  busy: boolean;
  onExecute: (
    command: OxygenRuntimeAction,
    file?: OxygenTransientFile
  ) => Promise<void>;
  onProof?: (file: OxygenTransientFile | undefined) => void;
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
  const { snapshot, client, busy, onExecute, scopeKey } = props;
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
  const [consentError, setConsentError] = useState<string | null>(null);
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: consent and codes are never restored across scope changes.
  useEffect(() => {
    setConsent(false);
    setConsentError(null);
  }, [scopeKey]);
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
    checkoutPhone: snapshot.checkoutPhone,
    setFieldErrors,
    setConsentError,
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
        setConsentError(null);
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
      consentError={consentError}
      onConsent={(value) => {
        setConsent(value);
        if (value) {
          setConsentError(null);
          if (error === 'Accept Oxygen’s terms before continuing.')
            setError(null);
        }
      }}
      error={identityFeedback.message(error) || bankConfirmation.error}
      checkoutAddress={props.checkoutHomeAddress}
    />
  );
}
