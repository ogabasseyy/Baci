import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import type Colors from '@/constants/Colors';
import { PiggyvestPrimaryWalletSchemas } from '@/schemas/piggyvest-primary-wallet';

interface Props {
  colors: (typeof Colors)['light'];
  merchantId: string;
  onSubmit: (input: {
    merchantId: string;
    bvn: string;
    consent: true;
  }) => Promise<void>;
}

export function PiggyvestWalletSetupForm({
  colors,
  merchantId,
  onSubmit,
}: Props) {
  const [bvn, setBvn] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  async function submit() {
    if (submitting.current) return;
    const parsed = PiggyvestPrimaryWalletSchemas.create.safeParse({
      merchantId,
      bvn,
      consent,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check your setup details.');
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError(null);
    setBvn('');
    try {
      await onSubmit(parsed.data);
    } catch {
      setError(
        'Wallet setup could not be confirmed. Refresh your account before trying again.'
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: 16 }}>
      <Text style={{ color: colors.text, fontSize: 20, fontWeight: '700' }}>
        Set up your PiggyVest wallet
      </Text>
      <Text style={{ color: colors.textSecondary }}>
        PiggyVest requires your BVN to verify your identity and create your bank
        transfer account.
      </Text>
      <TextInput
        accessibilityLabel="BVN"
        value={bvn}
        onChangeText={(value) => setBvn(value.replace(/\D/g, ''))}
        maxLength={11}
        keyboardType="number-pad"
        secureTextEntry
        autoCorrect={false}
        textContentType="none"
        editable={!busy}
        placeholder="11-digit BVN"
        placeholderTextColor={colors.placeholder}
        style={{
          color: colors.text,
          backgroundColor: colors.muted,
          padding: 18,
          borderRadius: 16,
        }}
      />
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel="Agree to PiggyVest identity verification"
        accessibilityState={{ checked: consent, disabled: busy }}
        disabled={busy}
        onPress={() => setConsent(!consent)}
        style={{ minHeight: 48, justifyContent: 'center' }}
      >
        <Text style={{ color: colors.text }}>
          {consent ? '☑' : '☐'} I agree to share my BVN with PiggyVest for
          wallet identity verification.
        </Text>
      </Pressable>
      {error ? (
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          {error}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Create PiggyVest account"
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        onPress={submit}
        style={{
          backgroundColor: colors.primary,
          padding: 18,
          borderRadius: 16,
          alignItems: 'center',
        }}
      >
        {busy ? (
          <ActivityIndicator color={colors.primaryForeground} />
        ) : (
          <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>
            Create account number
          </Text>
        )}
      </Pressable>
    </View>
  );
}
