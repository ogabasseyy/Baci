import type { OxygenMobileCapabilities } from '@baci/shared/oxygen';
import { router, useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import type { oxygenNativeSession } from '@/services/oxygen/native-session';
import { OxygenFooterVisibility } from './OxygenActionFooter';
import { OxygenActivatedOrderStep } from './OxygenActivatedOrderStep';
import { OxygenApplicationLoading } from './OxygenApplicationLoading';
import { OxygenOtp } from './OxygenOtp';
import { OxygenWorkflowBody } from './OxygenWorkflowBody';
import { OxygenWorkflowError } from './OxygenWorkflowError';
import type { OxygenFields } from './oxygen-form-utils';
import { OxygenAction } from './oxygen-presentation';
import { oxygenShowsInlineRecovery } from './oxygen-screen-layout';
import { useOxygenOtpCompletion } from './use-oxygen-otp-completion';
import { useOxygenWorkflow } from './use-oxygen-workflow';

type NativeSession = ReturnType<typeof oxygenNativeSession>;
export function OxygenCheckoutWorkflow({
  orderId,
  context,
}: {
  orderId: string;
  context: {
    session: NativeSession;
    capabilities: OxygenMobileCapabilities | null;
    total: number;
    orderNumber?: string;
    orderPaymentStatus: string;
    prefill?: OxygenFields;
  };
}) {
  const focused = useIsFocused();
  const workflow = useOxygenWorkflow(orderId, context.session.workflow);
  const completion = useOxygenOtpCompletion(workflow.snapshot);
  const routed = useRef(false);
  const [refreshing, setRefreshing] = useState<false | 'progress' | 'recovery'>(
    false
  );
  const [capabilities, setCapabilities] = useState(context.capabilities);
  const [selfieRetryAttempt, setSelfieRetryAttempt] = useState(0);
  const capabilitiesReady =
    Boolean(capabilities) && workflow.capabilitiesVerified;
  const capabilityUnavailable = !capabilities && !workflow.busy;
  const showRecovery =
    Boolean(workflow.error) ||
    capabilityUnavailable ||
    refreshing === 'recovery' ||
    (Boolean(workflow.snapshot) && !workflow.busy && !capabilitiesReady);
  const activated = workflow.snapshot?.stage === 'activated';
  const orderPaymentConfirmed = ['paid', 'bnpl_approved'].includes(
    context.orderPaymentStatus
  );
  const refresh = async () => {
    if (refreshing || workflow.busy) return;
    setRefreshing(showRecovery ? 'recovery' : 'progress');
    try {
      await workflow.refresh?.();
      const refreshed = await context.session
        .capabilities(false)
        .catch(() => null);
      setCapabilities(refreshed);
      const state = workflow.controller?.getState();
      if (
        showRecovery &&
        refreshed &&
        state?.capabilitiesVerified &&
        !state.error
      )
        setSelfieRetryAttempt((attempt) => attempt + 1);
    } finally {
      setRefreshing(false);
    }
  };
  useEffect(() => {
    if (activated && orderPaymentConfirmed && !routed.current) {
      routed.current = true;
      router.replace({
        pathname: '/order-success',
        params: {
          orderId,
          orderNumber: context.orderNumber,
          paymentMethod: 'oxygen',
        },
      });
    }
  }, [activated, orderPaymentConfirmed, orderId, context.orderNumber]);
  if (activated && !orderPaymentConfirmed)
    return (
      <OxygenActivatedOrderStep
        orderId={orderId}
        orderNumber={context.orderNumber}
      />
    );
  return (
    <OxygenFooterVisibility value={!completion}>
      <View
        style={{
          flexGrow: 1,
          gap: 16,
          justifyContent: 'flex-start',
        }}
      >
        {showRecovery ? (
          <OxygenWorkflowError
            busy={workflow.busy || Boolean(refreshing)}
            capabilityUnavailable={capabilityUnavailable}
            onRefresh={() => void refresh()}
          />
        ) : null}
        {completion ? (
          <OxygenOtp
            scopeKey={`${completion.workflowId}/${completion.kind}/success`}
            value=""
            onChange={() => undefined}
            onComplete={() => undefined}
            pending={false}
            confirmed
            label={
              completion.kind === 'approval'
                ? 'Payment plan approved'
                : undefined
            }
          />
        ) : null}
        {workflow.snapshot && workflow.controller ? (
          <OxygenFooterVisibility value={!completion && !showRecovery}>
            <View
              style={
                completion || showRecovery ? { display: 'none' } : undefined
              }
            >
              <OxygenWorkflowBody
                focused={focused}
                selfieRetryAttempt={selfieRetryAttempt}
                onViewOrders={() => router.push('/orders')}
                prefill={context.prefill}
                snapshot={workflow.snapshot}
                client={context.session.client}
                controller={workflow.controller}
                capabilities={
                  workflow.capabilitiesVerified ? capabilities : null
                }
                busy={
                  Boolean(completion) ||
                  workflow.busy ||
                  Boolean(refreshing) ||
                  !capabilitiesReady
                }
                productAmount={context.total}
                scopeKey={`${context.session.profile.storagePrefix}:${context.session.userId}:${context.session.profile.merchantId}:${orderId}`}
              />
            </View>
          </OxygenFooterVisibility>
        ) : !showRecovery ? (
          <OxygenApplicationLoading />
        ) : null}
        {!showRecovery &&
        !completion &&
        !workflow.busy &&
        !refreshing &&
        oxygenShowsInlineRecovery(workflow.snapshot) ? (
          <OxygenAction
            label="Check for an update"
            disabled={workflow.busy}
            onPress={() => void refresh()}
          />
        ) : null}
      </View>
    </OxygenFooterVisibility>
  );
}
