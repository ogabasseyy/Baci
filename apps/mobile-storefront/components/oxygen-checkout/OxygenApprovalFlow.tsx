import type {
  OxygenApprovalCodeWindow,
  OxygenRuntimeSnapshot,
  OxygenTransientFile,
} from '@baci/shared/oxygen';
import { useContext, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import type { OxygenClient } from '@/services/oxygen/client';
import type { OxygenWorkflowController } from '@/services/oxygen/workflow';
import { OxygenFooterVisibility } from './OxygenActionFooter';
import { OxygenBreakdown } from './OxygenBreakdown';
import { useOxygenColors } from './OxygenFormPrimitives';
import { OxygenOtp } from './OxygenOtp';
import { OxygenSignatureStep } from './OxygenSignatureStep';
import { confirmedOxygenTerms } from './oxygen-confirmed-terms';
import {
  canApproveOxygen,
  type OxygenConfirmedTerms,
  oxygenTermsKey,
} from './oxygen-plan';
import { OxygenAction } from './oxygen-presentation';

type OnApproved = (approval: {
  workflowId: string;
  bookingReference: string;
}) => void;

export function OxygenApprovalFlow({
  snapshot,
  client,
  controller,
  busy,
  onApproved,
}: {
  snapshot: OxygenRuntimeSnapshot;
  client: OxygenClient;
  controller: OxygenWorkflowController;
  busy: boolean;
  onApproved?: OnApproved;
}) {
  const terms = confirmedOxygenTerms(snapshot);
  const attempted = useRef(new Set<string>());
  const [checkedReference, setCheckedReference] = useState<string | null>(null);
  const colors = useOxygenColors();
  useEffect(() => {
    const reference = snapshot.state.bookingReference;
    if (
      terms ||
      busy ||
      !snapshot.executionEnabled ||
      snapshot.pending ||
      !reference ||
      attempted.current.has(reference) ||
      controller.getState().error
    )
      return;
    attempted.current.add(reference);
    void controller.execute({ action: 'refresh_details' }).finally(() => {
      setCheckedReference(reference);
    });
  }, [snapshot, controller, busy, terms]);
  return terms ? (
    <Approval
      key={oxygenTermsKey(terms)}
      snapshot={snapshot}
      terms={terms}
      client={client}
      controller={controller}
      busy={busy}
      onApproved={onApproved}
    />
  ) : (
    <View style={{ gap: 12 }}>
      <Text style={{ color: colors.text }}>
        {checkedReference === snapshot.state.bookingReference && !busy
          ? 'We couldn’t load your payment breakdown. Please try again.'
          : 'Preparing your payment breakdown…'}
      </Text>
      {checkedReference === snapshot.state.bookingReference &&
      !snapshot.pending ? (
        <OxygenAction
          label="Try again"
          disabled={busy || !snapshot.executionEnabled}
          onPress={() => void controller.execute({ action: 'refresh_details' })}
        />
      ) : null}
    </View>
  );
}
function Approval({
  snapshot,
  terms,
  client,
  controller,
  busy,
  onApproved,
}: {
  snapshot: OxygenRuntimeSnapshot;
  terms: OxygenConfirmedTerms;
  client: OxygenClient;
  controller: OxygenWorkflowController;
  busy: boolean;
  onApproved?: OnApproved;
}) {
  const termsKey = oxygenTermsKey(terms);
  const [reviewed, setReviewed] = useState(false);
  const [codeStep, setCodeStep] = useState(false);
  const footerVisible = useContext(OxygenFooterVisibility);
  const [accepted, setAccepted] = useState(false);
  const [signature, setSignature] = useState<{
    file: OxygenTransientFile;
    key: string;
  } | null>(null);
  const [window, setWindow] = useState<OxygenApprovalCodeWindow | null>(null);
  const [otp, setOtp] = useState('');
  const [windowError, setWindowError] = useState('');
  const [requestingCode, setRequestingCode] = useState(false);
  const codeRequestInFlight = useRef(false);
  const canApprove = canApproveOxygen({
    reference: terms.reference,
    termsKey,
    capturedTermsKey: signature?.key ?? null,
    signature: Boolean(signature),
    accepted,
    window,
    now: Date.now(),
    pending: snapshot.pending?.status ?? null,
  });
  // Requesting a code may advance the version. Signature remains bound to the exact material terms;
  // final submission additionally captures the currently displayed canonical version.
  const disabled =
    busy || Boolean(snapshot.pending) || !snapshot.executionEnabled;
  async function readActiveCodeWindow() {
    const { window } = await client.approvalWindow(snapshot.workflowId);
    return window?.bookingReference === terms.reference &&
      Date.parse(window.expiresAt) > Date.now()
      ? window
      : null;
  }
  async function requestCode() {
    if (disabled || codeRequestInFlight.current || !accepted || !signature)
      return;
    codeRequestInFlight.current = true;
    setRequestingCode(true);
    setWindowError('');
    try {
      // Recheck before sending so retrying a failed read can reuse a sent code.
      let activeWindow = await readActiveCodeWindow();
      if (!activeWindow) {
        const current = controller.getState();
        if (
          current.busy ||
          current.snapshot?.workflowId !== snapshot.workflowId ||
          current.snapshot.version !== snapshot.version
        )
          return;
        await controller.execute({ action: 'trigger_approval_otp' });
        if (controller.getState().error) return;
        activeWindow = await readActiveCodeWindow();
      }
      if (!activeWindow) {
        setWindowError('We couldn’t confirm your code. Try again.');
        return;
      }
      setWindow(activeWindow);
      setOtp('');
      setCodeStep(true);
    } catch {
      setWindowError('We couldn’t confirm your code. Try again.');
    } finally {
      setRequestingCode(false);
      codeRequestInFlight.current = false;
    }
  }
  async function approve(code: string) {
    if (!canApprove || !signature) return;
    await controller.execute(
      { action: 'approve_booking', otp: code, accepted: true },
      signature.file,
      { version: snapshot.version, bookingReference: terms.reference }
    );
    const { snapshot: confirmed, error } = controller.getState();
    if (
      !error &&
      confirmed?.workflowId === snapshot.workflowId &&
      confirmed.version > snapshot.version &&
      !confirmed.pending &&
      confirmed.stage === 'payment_required' &&
      confirmed.state.booking?.status === 'APPROVED' &&
      confirmed.state.bookingReference === terms.reference
    ) {
      onApproved?.({
        workflowId: confirmed.workflowId,
        bookingReference: terms.reference,
      });
    }
  }
  return (
    <View style={{ gap: 16 }}>
      {!reviewed ? (
        <OxygenBreakdown
          terms={terms}
          busy={disabled}
          canChangePlan={false}
          onAccept={() => setReviewed(true)}
          onChangePlan={() => undefined}
        />
      ) : (
        <>
          <OxygenFooterVisibility value={footerVisible && !codeStep}>
            <View
              style={codeStep ? { display: 'none' } : undefined}
              accessibilityElementsHidden={codeStep}
              importantForAccessibility={
                codeStep ? 'no-hide-descendants' : 'auto'
              }
            >
              <OxygenSignatureStep
                termsKey={termsKey}
                nextPaymentDate={terms.schedule[0]?.date}
                accepted={accepted}
                capturedTermsKey={signature?.key ?? null}
                disabled={disabled}
                requestingCode={requestingCode}
                onSignature={(file, key) =>
                  setSignature(file ? { file, key } : null)
                }
                onAccept={setAccepted}
                onContinue={() => void requestCode()}
              />
            </View>
          </OxygenFooterVisibility>
          {windowError ? (
            <Text accessibilityRole="alert">{windowError}</Text>
          ) : null}
          {codeStep && window ? (
            <>
              <OxygenOtp
                scopeKey={`${termsKey}:${window.sentAt}`}
                value={otp}
                onChange={setOtp}
                pending={disabled || requestingCode}
                confirmed={snapshot.stage === 'payment_required'}
                sentAt={window.sentAt}
                expiresAt={window.expiresAt}
                onComplete={(code) => void approve(code)}
                onResend={requestCode}
                label="Approve your payment breakdown"
              />
              <OxygenAction
                label="Back to signature"
                secondary
                disabled={disabled || requestingCode}
                onPress={() => setCodeStep(false)}
              />
            </>
          ) : null}
        </>
      )}
      {snapshot.pending ? (
        <OxygenAction
          label="Check saved approval progress"
          disabled={busy}
          onPress={() => void controller.refresh()}
        />
      ) : null}
    </View>
  );
}
