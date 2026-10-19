import Ionicons from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type Colors from '@/constants/Colors';
import { WalletFundPhoneSchema } from '@/schemas/wallet-fund-phone';

type WalletColors = (typeof Colors)['light'];

export interface WalletFundPhoneSubmitResult {
  error?: string;
  success: boolean;
}

interface WalletFundPhonePromptProps {
  colors: WalletColors;
  onSubmit: (phone: string) => Promise<WalletFundPhoneSubmitResult>;
}

const PROMPT_COPY =
  'Add your phone number so we can create your bank transfer account number.';
const SAVE_FAILED = 'Could not save your phone number. Please try again.';

export function WalletFundPhonePrompt({
  colors,
  onSubmit,
}: WalletFundPhonePromptProps) {
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async () => {
    const parsed = WalletFundPhoneSchema.safeParse({ phone });
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message ?? 'Valid phone number required'
      );
      return;
    }
    setError(null);
    setIsSaving(true);
    try {
      const result = await onSubmit(parsed.data.phone);
      // Leave the error visible so the customer can correct and retry; a
      // successful save flips availability and unmounts this prompt.
      if (!result.success) {
        setError(result.error ?? SAVE_FAILED);
      }
    } catch {
      setError(SAVE_FAILED);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={[styles.section, { borderColor: colors.border }]}>
      <View style={styles.headingRow}>
        <View style={[styles.icon, { backgroundColor: colors.muted }]}>
          <Ionicons name="business-outline" size={22} color={colors.primary} />
        </View>
        <Text style={[styles.title, { color: colors.text }]}>
          Set up bank transfer
        </Text>
      </View>
      <Text style={[styles.description, { color: colors.textSecondary }]}>
        {PROMPT_COPY}
      </Text>
      <Text style={[styles.label, { color: colors.textSecondary }]}>
        PHONE NUMBER
      </Text>
      <TextInput
        accessibilityLabel="Phone number"
        style={[
          styles.input,
          {
            backgroundColor: colors.muted,
            borderColor: colors.border,
            color: colors.text,
          },
        ]}
        value={phone}
        onChangeText={(value) => {
          setPhone(value);
          if (error) {
            setError(null);
          }
        }}
        editable={!isSaving}
        keyboardType="phone-pad"
        autoCapitalize="none"
        placeholder="08012345678"
        placeholderTextColor={colors.placeholder}
      />
      {error ? (
        <Text
          accessibilityRole="text"
          style={[styles.error, { color: colors.error }]}
        >
          {error}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Save phone number"
        accessibilityState={{ disabled: isSaving }}
        style={[styles.submit, { backgroundColor: colors.primary }]}
        onPress={handleSubmit}
        disabled={isSaving}
      >
        {isSaving ? (
          <ActivityIndicator color={colors.primaryForeground} size="small" />
        ) : (
          <Text
            style={[styles.submitText, { color: colors.primaryForeground }]}
          >
            Save and continue
          </Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { borderTopWidth: 1, marginTop: 20, paddingTop: 20 },
  headingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  icon: {
    alignItems: 'center',
    borderRadius: 14,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  title: { fontSize: 17, fontWeight: '700' },
  description: { fontSize: 14, lineHeight: 21, marginBottom: 24 },
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 10,
  },
  input: {
    borderRadius: 16,
    borderWidth: 1,
    fontSize: 18,
    minHeight: 64,
    paddingHorizontal: 18,
  },
  error: {
    fontSize: 12,
    marginTop: 8,
  },
  submit: {
    alignItems: 'center',
    borderRadius: 16,
    justifyContent: 'center',
    marginTop: 24,
    minHeight: 56,
  },
  submitText: {
    fontSize: 15,
    fontWeight: '700',
  },
});
