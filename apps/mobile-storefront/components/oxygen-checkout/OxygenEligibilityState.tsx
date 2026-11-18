import {
  type OxygenRuntimeSnapshot,
  oxygenEligibilityProgressLabels,
} from '@baci/shared/oxygen';
import { View } from 'react-native';
import { OxygenStatusCard } from './OxygenStatusCard';
import { OxygenVerificationProgress } from './OxygenVerificationProgress';
import { OxygenAction } from './oxygen-presentation';

export function OxygenEligibilityState({
  status,
  eligible,
  failureReason,
  progress,
  delayed,
  disabled,
  hasError,
  onRetry,
  onViewOrders,
}: {
  status?: OxygenRuntimeSnapshot['state']['eligibilityStatus'];
  eligible?: boolean;
  failureReason?: OxygenRuntimeSnapshot['state']['eligibilityFailureReason'];
  progress?: OxygenRuntimeSnapshot['state']['eligibilityProgress'];
  delayed: boolean;
  disabled: boolean;
  hasError: boolean;
  onRetry: () => void;
  onViewOrders: () => void;
}) {
  const title =
    status === 'pending' && progress
      ? oxygenEligibilityProgressLabels[progress]
      : undefined;
  if (disabled || (status === 'pending' && !delayed))
    return <OxygenVerificationProgress operation="eligibility" title={title} />;
  const declined = status === 'completed' && eligible === false;
  if (!hasError && status !== 'failed' && !delayed && !declined) return null;

  const mismatch = failureReason === 'financial_details_mismatch';
  const failed = status === 'failed' || hasError;
  return (
    <View style={{ gap: 16 }}>
      <OxygenStatusCard
        icon={failed || declined ? 'card-outline' : 'time-outline'}
        eyebrow="Oxygen verification"
        title={
          declined
            ? 'Oxygen couldn’t offer a payment plan'
            : failed
              ? 'We couldn’t complete the check'
              : (title ?? 'Oxygen is taking longer')
        }
        description={
          declined
            ? 'You can choose another payment method or contact support for help.'
            : mismatch
              ? 'Oxygen says your financial details do not match. Please contact your bank to check and update your details, or contact support for help. Then try again.'
              : failed
                ? 'Your progress is saved. Try again or contact support for help.'
                : 'Your verification is saved. You can check again when you’re ready.'
        }
      />
      <OxygenAction
        label={
          declined
            ? 'View my orders'
            : failed
              ? 'Try again'
              : 'Check for an update'
        }
        onPress={declined ? onViewOrders : onRetry}
      />
    </View>
  );
}
