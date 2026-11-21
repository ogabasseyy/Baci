import { Text, View } from 'react-native';
import { OxygenButton, useOxygenColors } from './OxygenFormPrimitives';

export function OxygenSelfieRecovery({
  renewing,
  error,
  onRenew,
}: {
  renewing: boolean;
  error?: string;
  onRenew?: () => void;
}) {
  const colors = useOxygenColors();
  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 20 }}>
      <Text
        accessibilityRole="header"
        style={{ color: colors.text, fontSize: 24, fontWeight: '600' }}
      >
        {renewing
          ? 'Refreshing your verification session…'
          : 'Your verification session expired'}
      </Text>
      <Text
        style={{ color: colors.textSecondary, fontSize: 16, lineHeight: 24 }}
      >
        {renewing
          ? 'We’re getting a new link. Your progress is saved.'
          : 'Your progress is saved. Try again to continue your selfie.'}
      </Text>
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          {error}
        </Text>
      )}
      {onRenew && (
        <OxygenButton
          title={renewing ? 'Refreshing session…' : 'Try again'}
          loading={renewing}
          onPress={onRenew}
        />
      )}
    </View>
  );
}
