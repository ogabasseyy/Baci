import type { OxygenMobileCapabilities } from '@baci/shared/oxygen';
import { router, useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import type { oxygenNativeSession } from '@/services/oxygen/native-session';
import { OxygenFooterVisibility } from './OxygenActionFooter';
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
  const showRecovery = Boolean(workflow.error) || refreshing === 'recovery';
  const [capabilities, setCapabilities] = useState(context.capabilities);
  const refresh = async () => {
    if (refreshing || workflow.busy) return;
    setRefreshing(workflow.error ? 'recovery' : 'progress');
    try {
      await workflow.refresh?.();
      await context.session
        .capabilities(false)
        .then(setCapabilities, () => setCapabilities(null));
    } finally {
      setRefreshing(false);
    }
  };
  useEffect(() => {
    if (workflow.snapshot?.stage === 'activated' && !routed.current) {
      routed.current = true;
      router.replace({
        pathname: '/order-success',
        params: { orderId, paymentMethod: 'oxygen' },
      });
    }
  }, [workflow.snapshot?.stage, orderId]);
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
                  !capabilities ||
                  !workflow.capabilitiesVerified
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
