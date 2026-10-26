import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { BRAND, type default as Colors, palette } from '@/constants/Colors';
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
  const [showBvn, setShowBvn] = useState(false);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const createDisabled = busy || !consent;

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
    try {
      await onSubmit(parsed.data);
      // Clear only after the setup is confirmed: a failure keeps the BVN
      // for correction-free retry, while success drops the sensitive
      // value from state at the earliest safe moment.
      setBvn('');
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null
          ? (error as { code?: unknown }).code
          : undefined;
      if (code === 'INVALID_BVN') {
        // The number itself was rejected: keeping a known-wrong BVN in
        // state serves no retry (the user must enter a different one),
        // so drop the sensitive value now instead of widening its
        // lifetime in memory. Transient failures below keep it for a
        // correction-free retry of a possibly-right number.
        setBvn('');
        setError('That BVN was rejected. Check the number and try again.');
      } else if (code === 'PROFILE_VERIFICATION_REQUIRED') {
        setError(
          'Verify your email and complete your name and phone number before creating your wallet.'
        );
      } else if (code === 'OWNERSHIP_REVIEW_REQUIRED') {
        setError(
          'Your wallet identity needs review. Contact support; do not create another wallet.'
        );
      } else {
        setError(
          'Wallet setup could not be confirmed. Refresh your account before trying again.'
        );
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: 16 }}>
      <Text style={{ color: colors.text, fontSize: 20, fontWeight: '700' }}>
        Create your account number
      </Text>
      <Text style={{ color: colors.textSecondary }}>
        Verify your identity to receive bank transfers.
      </Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 16,
          backgroundColor: colors.muted,
        }}
      >
        <BottomSheetTextInput
          accessibilityLabel="BVN"
          value={bvn}
          onChangeText={(value) => setBvn(value.replace(/\D/g, ''))}
          maxLength={11}
          keyboardType="number-pad"
          secureTextEntry={!showBvn}
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
            flex: 1,
          }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={showBvn ? 'Hide BVN' : 'Show BVN'}
          disabled={busy}
          onPress={() => setShowBvn(!showBvn)}
          style={{
            minWidth: 44,
            minHeight: 44,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons
            name={showBvn ? 'eye-off-outline' : 'eye-outline'}
            size={22}
            color={colors.textSecondary}
          />
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel="Agree to PiggyVest identity verification"
        accessibilityState={{ checked: consent, disabled: busy }}
        disabled={busy}
        onPress={() => setConsent(!consent)}
        style={{
          minHeight: 48,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <View
          testID="wallet-consent-indicator"
          style={{
            width: 28,
            height: 28,
            borderWidth: 2,
            borderRadius: 6,
            borderColor: consent ? BRAND.primary : colors.textSecondary,
            backgroundColor: consent ? BRAND.primary : colors.card,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {consent ? (
            <Ionicons name="checkmark" size={20} color={palette.white} />
          ) : null}
        </View>
        <Text style={{ color: colors.text, flex: 1, lineHeight: 21 }}>
          I agree to share my BVN with PiggyVest for wallet identity
          verification.
        </Text>
      </Pressable>
      {error ? (
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          {error}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Create account number"
        accessibilityState={{ disabled: createDisabled }}
        disabled={createDisabled}
        onPress={submit}
        style={{
          backgroundColor: consent ? BRAND.primary : colors.muted,
          padding: 18,
          borderRadius: 16,
          alignItems: 'center',
        }}
      >
        {busy ? (
          <ActivityIndicator
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel="Creating account number"
            color={consent ? palette.white : colors.text}
          />
        ) : (
          <Text
            style={{
              color: consent ? palette.white : colors.text,
              fontWeight: '700',
            }}
          >
            Create account number
          </Text>
        )}
      </Pressable>
    </View>
  );
}
