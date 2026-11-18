import Ionicons from '@react-native-vector-icons/ionicons';
import {
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useOxygenColors } from './OxygenFormPrimitives';

const TERMS_URL = 'https://www.oxygenx.africa/terms-of-service';

export function OxygenApplicationConsent({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  const colors = useOxygenColors();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel="I agree to share these details with Oxygen and accept Oxygen’s terms"
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      style={[
        styles.card,
        {
          backgroundColor: colors.muted,
          borderColor: checked ? colors.primary : colors.border,
        },
      ]}
    >
      <View style={styles.check} accessible={false}>
        <Ionicons
          name={checked ? 'checkbox' : 'square-outline'}
          size={24}
          color={checked ? colors.primary : colors.textSecondary}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.text, { color: colors.textSecondary }]}>
          I agree to share these details with Oxygen for this finance
          application and accept{' '}
          <Text
            accessibilityRole="link"
            accessibilityLabel="Read Oxygen’s terms"
            onPress={(event) => {
              event.stopPropagation();
              void Linking.openURL(TERMS_URL).catch(() =>
                Alert.alert('Could not open terms', 'Please try again.')
              );
            }}
            style={{
              color: colors.primary,
              textDecorationLine: 'underline',
              fontWeight: '600',
            }}
          >
            Oxygen’s terms
          </Text>
          .
        </Text>
      </View>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderWidth: 1,
    borderRadius: 14,
  },
  check: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { fontSize: 13, lineHeight: 21, paddingVertical: 4 },
});
