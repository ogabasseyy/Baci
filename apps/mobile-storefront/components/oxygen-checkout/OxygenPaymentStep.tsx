import { Text, View } from 'react-native';
import { OxygenActionFooter } from './OxygenActionFooter';
import { useOxygenColors } from './OxygenFormPrimitives';
import { OxygenStatusCard } from './OxygenStatusCard';
import {
  OxygenAction,
  oxygenMoney,
  oxygenPresentation as styles,
} from './oxygen-presentation';
export function OxygenPaymentStep({
  state,
  busy = false,
  showRefresh = state !== 'ready',
  onContinue,
  paymentComplete = false,
  upfrontAmount,
  onRefresh,
}: {
  state: 'ready' | 'confirming' | 'expired' | 'checkpoint' | 'unavailable';
  busy?: boolean;
  showRefresh?: boolean;
  paymentComplete?: boolean;
  upfrontAmount?: number;
  onContinue: () => void;
  onRefresh: () => void;
}) {
  const colors = useOxygenColors();
  const title =
    state === 'checkpoint'
      ? 'Your upfront steps are complete'
      : state === 'confirming'
        ? 'Confirming your payment'
        : state === 'expired'
          ? 'Payment link expired'
          : paymentComplete
            ? 'Set up your repayments'
            : 'Pay your upfront amount';
  const copy =
    state === 'checkpoint'
      ? 'Oxygen has confirmed your upfront payment and repayment setup.'
      : state === 'confirming'
        ? 'Your progress is saved. Wait for Oxygen’s confirmation before making another payment.'
        : state === 'expired'
          ? 'Check your saved progress to recover the payment link.'
          : state === 'unavailable'
            ? 'Your payment link is unavailable. Check your payment status to continue.'
            : paymentComplete
              ? 'Oxygen has confirmed your upfront payment. Set up how Oxygen will collect your monthly repayments.'
              : 'Continue to Oxygen’s secure page to make your upfront payment.';
  return (
    <View style={[styles.section, { padding: 0 }]}>
      <OxygenStatusCard
        eyebrow="YOUR PAYMENT PLAN"
        icon={
          state === 'checkpoint'
            ? 'checkmark-circle-outline'
            : state === 'confirming'
              ? 'time-outline'
              : 'card-outline'
        }
        title={title}
        description={copy}
      />
      {state === 'ready' && !paymentComplete && upfrontAmount !== undefined && (
        <View
          style={{
            backgroundColor: colors.primaryLowOpacity,
            borderRadius: 12,
            padding: 14,
            gap: 4,
          }}
        >
          <Text style={{ color: colors.textSecondary }}>Due upfront</Text>
          <Text style={{ color: colors.text, fontSize: 24, fontWeight: '700' }}>
            {oxygenMoney(upfrontAmount)}
          </Text>
        </View>
      )}
      {state === 'ready' && (
        <OxygenActionFooter>
          <OxygenAction
            label={
              paymentComplete ? 'Complete repayment setup' : 'Continue payment'
            }
            disabled={busy}
            onPress={onContinue}
          />
        </OxygenActionFooter>
      )}
      {showRefresh && (
        <OxygenAction
          secondary
          label="Check payment status"
          disabled={busy}
          onPress={onRefresh}
        />
      )}
    </View>
  );
}
