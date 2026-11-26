import type {
  OxygenMobileCapabilities,
  OxygenRuntimeSnapshot,
  OxygenTransientFile,
} from '@baci/shared/oxygen';
import { type RefObject, useState } from 'react';
import { Text, View } from 'react-native';
import type { OxygenClient } from '@/services/oxygen/client';
import { resendOxygenPhoneCode } from '@/services/oxygen/resend-phone-code';
import type { OxygenWorkflowController } from '@/services/oxygen/workflow';
import { OxygenApplicationFlow } from './OxygenApplicationFlow';
import { OxygenApprovalFlow } from './OxygenApprovalFlow';
import { OxygenBookedAddress } from './OxygenBookedAddress';
import { OxygenEligibilityState } from './OxygenEligibilityState';
import { useOxygenColors } from './OxygenFormPrimitives';
import { OxygenHostedModal } from './OxygenHostedModal';
import { OxygenIdentityStep } from './OxygenIdentityStep';
import { OxygenOfferRefresh } from './OxygenOfferRefresh';
import { OxygenPaymentStep } from './OxygenPaymentStep';
import { OxygenPlanStep } from './OxygenPlanStep';
import {
  canRefreshOxygenSavedApprovalOffers,
  oxygenPrebookingStep,
  oxygenRecoveryMode,
  oxygenSavedApprovalOffersMissing,
  oxygenSelfieRequired,
  oxygenUnfinishedPayment,
} from './oxygen-checkout-presentation';
import type { OxygenFields } from './oxygen-form-utils';
import { canOpenOxygenHostedUrl } from './oxygen-hosted-navigation';
import { defaultOxygenEquity } from './oxygen-plan';
import { OxygenAction } from './oxygen-presentation';
import { useOxygenEligibilityProgress } from './use-oxygen-eligibility-progress';
import { useOxygenHostedStep } from './use-oxygen-hosted-step';
import { useOxygenInitialNin } from './use-oxygen-initial-nin';
import { useOxygenPhoneMarker } from './use-oxygen-phone-marker';
export function OxygenWorkflowBody({
  focused,
  hostedHandlesForeground,
  onViewOrders,
  snapshot,
  client,
  controller,
  capabilities,
  busy,
  productAmount,
  scopeKey,
  selfieRetryAttempt,
  prefill,
}: {
  focused: boolean;
  hostedHandlesForeground?: RefObject<boolean>;
  onViewOrders: () => void;
  snapshot: OxygenRuntimeSnapshot;
  client: OxygenClient;
  controller: OxygenWorkflowController;
  capabilities: OxygenMobileCapabilities | null;
  busy: boolean;
  productAmount: number;
  scopeKey: string;
  selfieRetryAttempt?: number;
  prefill?: OxygenFields;
}) {
  const colors = useOxygenColors();
  const [proof, setProof] = useState<OxygenTransientFile | undefined>();
  const phoneMarker = useOxygenPhoneMarker(
    `${scopeKey}:${snapshot.workflowId}`
  );
  const [equity, setEquity] = useState<number | null>(null);
  const [tenure, setTenure] = useState<number | null>(null);
  const s = snapshot.state;
  const prebookingStep = oxygenPrebookingStep(snapshot);
  const limits = {
    productAmount,
    eligibleAmount: s.eligibleAmount ?? 0,
    minimumAmount: s.minimumAmount ?? 0,
    maxTenure: s.maxTenure ?? 0,
    offers: s.offers,
    minEquity: 25,
    maxEquity: 90,
  };
  const selectedTenure =
    tenure ??
    (s.offers?.length ? Math.max(...s.offers.map((offer) => offer.tenure)) : 1);
  const selectedEquity =
    equity ?? defaultOxygenEquity(limits, selectedTenure) ?? 25;
  const disabled =
    !focused || busy || !snapshot.executionEnabled || Boolean(snapshot.pending);
  const paymentConfirmed =
    snapshot.stage === 'ready_for_activation' ||
    (s.paymentComplete && s.setupComplete);
  const savedOffersMissing = oxygenSavedApprovalOffersMissing(snapshot);
  const unfinishedPayment = oxygenUnfinishedPayment(snapshot);
  const paymentUrl =
    unfinishedPayment &&
    capabilities &&
    canOpenOxygenHostedUrl(unfinishedPayment.url, 'payment', capabilities)
      ? unfinishedPayment.url
      : undefined;
  const {
    hosted,
    requesting,
    renewal,
    open: setHosted,
    refresh,
    close,
    openApprovedPayment,
    paymentOpened,
  } = useOxygenHostedStep({
    snapshot,
    client,
    controller,
    disabled,
    ready: Boolean(capabilities),
    paymentUrl,
    selfieRetryAttempt,
  });
  const eligibilityProgress = useOxygenEligibilityProgress(
    snapshot,
    controller,
    disabled
  );
  const initialNinRunning = useOxygenInitialNin(snapshot, controller, disabled);
  const selfieRequired = oxygenSelfieRequired(snapshot);
  const recoveryMode = oxygenRecoveryMode(snapshot);
  const url = hosted === 'selfie' ? s.selfieUrl : paymentUrl;
  const command = async (
    action:
      | 'refresh_kyc'
      | 'refresh_eligibility'
      | 'validate_nin'
      | 'refresh_payment_setup'
      | 'selfie_link'
  ) => {
    await controller.execute({ action });
  };
  return (
    <View style={{ gap: 16 }}>
      <OxygenApplicationFlow
        checkoutHomeAddress={
          prefill?.home_street ? { kind: 'delivery', fields: prefill } : null
        }
        prefill={prefill}
        snapshot={snapshot}
        client={client}
        busy={disabled}
        onExecute={controller.execute}
        onProof={setProof}
        scopeKey={snapshot.workflowId}
        phoneSentAt={phoneMarker.sentAt}
        onPhoneSentAt={phoneMarker.mark}
        onResendPhone={() => resendOxygenPhoneCode(controller)}
        selfieRequired={selfieRequired}
        selfieLoading={disabled || requesting}
        onContinueSelfie={() =>
          s.selfieUrl ? setHosted('selfie') : void command('selfie_link')
        }
      />
      {prebookingStep === 'eligibility' ? (
        <OxygenEligibilityState
          status={s.eligibilityStatus}
          eligible={s.eligible}
          failureReason={s.eligibilityFailureReason}
          progress={s.eligibilityProgress}
          delayed={eligibilityProgress.delayed}
          disabled={disabled}
          hasError={Boolean(controller.getState().error)}
          onRetry={() => void command('refresh_eligibility')}
          onViewOrders={onViewOrders}
        />
      ) : null}
      {prebookingStep === 'verification' && !selfieRequired ? (
        <OxygenIdentityStep
          snapshot={snapshot}
          busy={disabled}
          verifyingRequest={initialNinRunning}
          onVerify={() => void command('validate_nin')}
          onRefresh={() => void command('refresh_kyc')}
        />
      ) : null}
      {savedOffersMissing ||
      (snapshot.stage === 'plan_required' && !s.offers) ? (
        <OxygenOfferRefresh
          disabled={
            disabled ||
            (savedOffersMissing &&
              !canRefreshOxygenSavedApprovalOffers(snapshot))
          }
          onRefresh={() => void command('refresh_eligibility')}
        />
      ) : null}
      {snapshot.stage === 'plan_required' && s.offers ? (
        <OxygenPlanStep
          limits={limits}
          equityPercentage={selectedEquity}
          tenure={selectedTenure}
          onEquityChange={setEquity}
          onTenureChange={(value) => {
            setEquity(selectedEquity);
            setTenure(value);
          }}
          busy={disabled}
          onBook={(value) => void controller.execute(value)}
        />
      ) : null}
      {snapshot.stage === 'booked' ? (
        <OxygenBookedAddress
          snapshot={snapshot}
          client={client}
          proof={proof}
          checkoutAddress={
            prefill?.home_street ? { kind: 'delivery', fields: prefill } : null
          }
          busy={busy}
          onExecute={controller.execute}
          onRefresh={() => void command('refresh_kyc')}
        />
      ) : null}
      {snapshot.stage === 'approval_required' && !savedOffersMissing ? (
        <OxygenApprovalFlow
          snapshot={snapshot}
          client={client}
          controller={controller}
          busy={busy}
          onApproved={openApprovedPayment}
        />
      ) : null}
      {snapshot.stage === 'payment_required' ||
      snapshot.stage === 'ready_for_activation' ? (
        <OxygenPaymentStep
          state={
            paymentConfirmed
              ? 'checkpoint'
              : snapshot.pending
                ? 'confirming'
                : paymentUrl
                  ? 'ready'
                  : 'unavailable'
          }
          busy={disabled}
          showRefresh={
            !snapshot.pending &&
            (paymentConfirmed || paymentOpened || !paymentUrl)
          }
          paymentComplete={s.paymentComplete}
          upfrontAmount={s.booking?.total_upfront_payment ?? undefined}
          onContinue={() => setHosted('payment')}
          onRefresh={() => void command('refresh_payment_setup')}
        />
      ) : null}
      {snapshot.stage === 'reconciliation_required' ? (
        <Text style={{ color: colors.textSecondary }}>
          Your progress needs review. Check for an update or contact support
          before trying again.
        </Text>
      ) : null}
      {hosted && url && capabilities ? (
        <OxygenHostedModal
          url={url}
          kind={hosted}
          capabilities={capabilities}
          active
          handlesForeground={hostedHandlesForeground}
          onRefresh={refresh}
          onExit={close}
          sessionExpired={hosted === 'selfie' && renewal.expired}
          renewing={hosted === 'selfie' && renewal.renewing}
          renewalError={renewal.error}
          onRenew={hosted === 'selfie' ? () => void renewal.renew() : undefined}
        />
      ) : null}
      {snapshot.pending ? (
        <>
          <Text style={{ color: colors.textSecondary }}>
            Your previous request is saved. Check its status before continuing.
          </Text>
          <OxygenAction
            label={
              recoveryMode === 'address'
                ? 'Replace missing address proof'
                : recoveryMode === 'phone'
                  ? 'Enter a new phone code'
                  : recoveryMode === 'recover'
                    ? 'Recover saved progress'
                    : 'Check saved request status'
            }
            disabled={busy}
            onPress={() => {
              if (recoveryMode === 'address')
                void controller.retireQueuedAddress();
              else if (recoveryMode === 'phone')
                void controller.retireQueuedPhone();
              else if (recoveryMode === 'recover') void controller.recover();
              else void controller.refresh();
            }}
          />
        </>
      ) : null}
    </View>
  );
}
