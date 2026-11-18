import { useState } from 'react';
import { View } from 'react-native';
import type { OxygenApplicationFlowProps } from './OxygenApplicationFlow';
import { OxygenButton } from './OxygenFormPrimitives';
import { OxygenOtp } from './OxygenOtp';

type Props = Pick<
  OxygenApplicationFlowProps,
  | 'snapshot'
  | 'busy'
  | 'onExecute'
  | 'client'
  | 'onResendPhone'
  | 'phoneSentAt'
  | 'onPhoneSentAt'
  | 'scopeKey'
  | 'selfieRequired'
  | 'selfieLoading'
  | 'onContinueSelfie'
> & { error?: string | null };

export function OxygenPhoneVerification(props: Props) {
  const [otp, setOtp] = useState('');
  const { snapshot, busy, onExecute, client, scopeKey } = props;
  return (
    <View style={{ gap: 16 }}>
      <OxygenOtp
        scopeKey={`${scopeKey}/phone`}
        value={otp}
        onChange={setOtp}
        onComplete={(code) => {
          void onExecute({ action: 'validate_customer', otp: code });
        }}
        pending={busy}
        confirmed={
          Boolean(snapshot.state.validated) ||
          snapshot.state.kyc?.phone_status === 'DONE'
        }
        sentAt={props.phoneSentAt}
        onResend={async () => {
          if (props.onResendPhone) await props.onResendPhone();
          else {
            await onExecute({ action: 'resend_customer_otp' });
            const updated = await client.snapshot(snapshot.workflowId);
            if (
              updated.version <= snapshot.version ||
              updated.pending ||
              updated.state.applicationReference !==
                snapshot.state.applicationReference
            )
              throw new Error('Code send unconfirmed');
          }
          props.onPhoneSentAt?.(new Date().toISOString());
        }}
        error={props.error}
      />
      {props.selfieRequired ? (
        <OxygenButton
          title={
            props.selfieLoading ? 'Opening camera…' : 'Continue verification'
          }
          loading={props.selfieLoading}
          disabled={busy}
          onPress={() => props.onContinueSelfie?.()}
        />
      ) : null}
    </View>
  );
}
