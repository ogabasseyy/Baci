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

export function OxygenApprovalFlow({
  snapshot,
  client,
  controller,
  busy,
}: {
  snapshot: OxygenRuntimeSnapshot;
  client: OxygenClient;
  controller: OxygenWorkflowController;
  busy: boolean;
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
}: {
  snapshot: OxygenRuntimeSnapshot;
  terms: OxygenConfirmedTerms;
  client: OxygenClient;
  controller: OxygenWorkflowController;
  busy: boolean;
}) {
  const termsKey = oxygenTermsKey(terms);
  const [reviewed, setReviewed] = useState(false);
  const [codeStep, setCodeStep] = useState(false);
  const footerVisible = useContext(OxygenFooterVisibility);
  const [accepted, setAccepted] = useState(false);
  const [signature, setSignature] = useState<{
    file: OxygenTransientFile;
    key: string;
    version: number;
  } | null>(null);
  const [window, setWindow] = useState<OxygenApprovalCodeWindow | null>(null);
  const [otp, setOtp] = useState('');
  const [windowError, setWindowError] = useState('');
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh the server approval window after every canonical transition.
  useEffect(() => {
    let live = true;
    setWindow(null);
    setOtp('');
    void client.approvalWindow(snapshot.workflowId).then(
      (r) => {
        if (live) setWindow(r.window);
      },
      () => {
        if (live)
          setWindowError(
            'Your approval window could not be confirmed. Check for an update.'
          );
      }
    );
    return () => {
      live = false;
    };
  }, [client, snapshot.workflowId, snapshot.version]);
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
  async function requestCode() {
    if (disabled || !accepted || !signature) return;
    if (window && Date.parse(window.expiresAt) > Date.now()) return;
    await controller.execute({ action: 'trigger_approval_otp' });
  }
  async function continueToCode() {
    if (disabled || !accepted || !signature) return;
    if (
      !window ||
      window.bookingReference !== terms.reference ||
      Date.parse(window.expiresAt) <= Date.now()
    ) {
      await controller.execute({ action: 'trigger_approval_otp' });
      if (controller.getState().error) return;
    }
    setCodeStep(true);
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
                onSignature={(file, key) =>
                  setSignature(
                    file ? { file, key, version: snapshot.version } : null
                  )
                }
                onAccept={setAccepted}
                onContinue={() => void continueToCode()}
              />
            </View>
          </OxygenFooterVisibility>
          {windowError ? (
            <Text accessibilityRole="alert">{windowError}</Text>
          ) : null}
          {codeStep && !window ? (
            <Text>Preparing your verification code…</Text>
          ) : null}
          {codeStep && window ? (
            <>
              <OxygenOtp
                scopeKey={`${termsKey}:${window.sentAt}`}
                value={otp}
                onChange={setOtp}
                pending={disabled}
                confirmed={snapshot.stage === 'payment_required'}
                sentAt={window.sentAt}
                expiresAt={window.expiresAt}
                onComplete={(code) => {
                  if (canApprove && signature)
                    void controller.execute(
                      { action: 'approve_booking', otp: code, accepted: true },
                      signature.file,
                      {
                        version: snapshot.version,
                        bookingReference: terms.reference,
                      }
                    );
                }}
                onResend={requestCode}
                label="Approve your payment breakdown"
              />
              <OxygenAction
                label="Back to signature"
                secondary
                disabled={disabled}
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
