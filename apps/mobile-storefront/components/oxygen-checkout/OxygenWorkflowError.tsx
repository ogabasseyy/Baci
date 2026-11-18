import Ionicons from '@react-native-vector-icons/ionicons';
import { Text, View } from 'react-native';
import { OxygenActionFooter } from './OxygenActionFooter';
import { OxygenButton, useOxygenColors } from './OxygenFormPrimitives';

export function OxygenWorkflowError({
  busy,
  onRefresh,
}: {
  busy: boolean;
  onRefresh: () => void;
}) {
  const colors = useOxygenColors();
  return (
    <View
      accessibilityRole="alert"
      style={{ gap: 16, alignItems: 'center', paddingVertical: 24 }}
    >
      <Ionicons name="alert-circle-outline" size={38} color={colors.primary} />
      <Text
        accessibilityRole="header"
        style={{
          fontSize: 23,
          fontWeight: '700',
          color: colors.text,
          textAlign: 'center',
        }}
      >
        We couldn’t confirm this step
      </Text>
      <Text
        style={{
          fontSize: 15,
          lineHeight: 23,
          color: colors.textSecondary,
          textAlign: 'center',
        }}
      >
        Check your saved progress before trying again. You don’t need to restart
        your application.
      </Text>
      <OxygenActionFooter>
        <OxygenButton
          title={busy ? 'Checking your progress…' : 'Check for an update'}
          loading={busy}
          onPress={onRefresh}
        />
      </OxygenActionFooter>
    </View>
  );
}
