import type { OxygenRuntimeSnapshot } from '@baci/shared/oxygen';
import { Text, View } from 'react-native';
import { useOxygenColors } from './OxygenFormPrimitives';
import { OxygenVerificationProgress } from './OxygenVerificationProgress';
import { OxygenAction } from './oxygen-presentation';

export function OxygenIdentityStep({
  snapshot,
  busy,
  onVerify,
  onRefresh,
  verifyingRequest = false,
}: {
  snapshot: OxygenRuntimeSnapshot;
  busy: boolean;
  verifyingRequest?: boolean;
  onVerify: () => void;
  onRefresh: () => void;
}) {
  const colors = useOxygenColors();
  const kyc = snapshot.state.kyc;
  const validationInFlight =
    verifyingRequest || snapshot.pending?.action === 'validate_nin';
  const verifying = validationInFlight || kyc?.nin_status === 'PROCESSING';
  const canVerify =
    snapshot.state.eligible === true &&
    kyc?.nin_status === 'NOT_DONE' &&
    ['first_attempt', 'safe_retry'].includes(snapshot.ninAttemptStatus ?? '');
  const unavailable = snapshot.ninAttemptStatus === 'unavailable';
  return (
    <View style={{ gap: 16 }}>
      {verifying ? (
        <OxygenVerificationProgress operation="nin" />
      ) : busy ? (
        <OxygenVerificationProgress operation="status" />
      ) : (
        <>
          <Text
            accessibilityRole="header"
            style={{ color: colors.text, fontSize: 24, fontWeight: '600' }}
          >
            {unavailable
              ? 'We couldn’t start your identity check'
              : canVerify
                ? 'Continue your identity verification'
                : 'Your identity check is pending'}
          </Text>
          <Text style={{ color: colors.textSecondary }}>
            {unavailable
              ? 'Your details are saved. We couldn’t confirm the verification status right now.'
              : 'Your completed checks are saved.'}
          </Text>
        </>
      )}
      {canVerify && !verifying ? (
        <OxygenAction
          label="Continue verification"
          disabled={busy}
          onPress={onVerify}
        />
      ) : null}
      {!busy && !validationInFlight ? (
        <OxygenAction
          label="Check for an update"
          secondary={canVerify}
          onPress={onRefresh}
        />
      ) : null}
    </View>
  );
}
