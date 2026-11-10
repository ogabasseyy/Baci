import Ionicons from '@react-native-vector-icons/ionicons';
import { type ComponentProps, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import type Colors from '@/constants/Colors';
import { BRAND } from '@/constants/Colors';
import { PiggyvestPrimaryWalletSchemas } from '@/schemas/piggyvest-primary-wallet';
import { setupStyles } from './piggyvest-wallet-setup.styles';

// Server codes where refreshing cannot help; only waiting can.
const SETUP_UNAVAILABLE_CODES = new Set([
  'PROVIDER_UNAVAILABLE',
  'NOT_CONFIGURED',
  'PIGGYVEST_NOT_READY',
  'PIGGYVEST_ONBOARDING_NOT_READY',
  'PIGGYVEST_UNAVAILABLE',
]);

const SETUP_BENEFITS: readonly {
  icon: ComponentProps<typeof Ionicons>['name'];
  text: string;
}[] = [
  { icon: 'card-outline', text: 'Your own account number for bank transfers' },
  { icon: 'flag-outline', text: 'Save towards your next gadget' },
  { icon: 'lock-closed-outline', text: 'Your BVN is only used to verify you' },
];

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
          'Please verify your email and complete your profile, then try again.'
        );
      } else if (
        typeof code === 'string' &&
        SETUP_UNAVAILABLE_CODES.has(code)
      ) {
        // Nothing to refresh: setup or PiggyVest is not available yet, so
        // tell the customer plainly to come back later.
        setError(
          'Wallet setup is unavailable right now. Please try again later.'
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
    <View style={setupStyles.form}>
      <View style={setupStyles.header}>
        <View
          style={[
            setupStyles.headerIcon,
            { backgroundColor: BRAND.primaryAlpha12 },
          ]}
        >
          <Ionicons
            accessible={false}
            importantForAccessibility="no"
            name="shield-checkmark"
            size={24}
            color={BRAND.primary}
          />
        </View>
        <Text style={[setupStyles.title, { color: colors.text }]}>
          Set up your PiggyVest wallet
        </Text>
        <Text style={[setupStyles.subtitle, { color: colors.textSecondary }]}>
          PiggyVest requires your BVN to verify your identity and create your
          bank transfer account.
        </Text>
      </View>
      <View style={[setupStyles.benefits, { backgroundColor: colors.muted }]}>
        {SETUP_BENEFITS.map((benefit) => (
          <View key={benefit.text} style={setupStyles.benefitRow}>
            <Ionicons
              accessible={false}
              importantForAccessibility="no"
              name={benefit.icon}
              size={17}
              color={BRAND.primary}
            />
            <Text style={[setupStyles.benefitText, { color: colors.text }]}>
              {benefit.text}
            </Text>
          </View>
        ))}
      </View>
      <View style={setupStyles.field}>
        <Text style={[setupStyles.fieldLabel, { color: colors.text }]}>
          Your BVN
        </Text>
        <View
          style={[
            setupStyles.inputWrap,
            { backgroundColor: colors.muted, borderColor: BRAND.primary },
          ]}
        >
          <Ionicons
            accessible={false}
            importantForAccessibility="no"
            name="lock-closed-outline"
            size={18}
            color={colors.textSecondary}
          />
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
            style={[setupStyles.input, { color: colors.text }]}
          />
          <Text style={[setupStyles.counter, { color: colors.textSecondary }]}>
            {bvn.length}/11
          </Text>
        </View>
        <Text style={[setupStyles.hint, { color: colors.textSecondary }]}>
          Forgot it? Dial *565*0# from the phone number linked to your bank.
        </Text>
      </View>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel="Agree to PiggyVest identity verification"
        accessibilityState={{ checked: consent, disabled: busy }}
        disabled={busy}
        onPress={() => setConsent(!consent)}
        style={setupStyles.consentRow}
      >
        <View
          style={[
            setupStyles.checkbox,
            consent
              ? { backgroundColor: BRAND.primary, borderColor: BRAND.primary }
              : { borderColor: colors.textSecondary },
          ]}
        >
          {consent ? (
            <Ionicons
              accessible={false}
              importantForAccessibility="no"
              name="checkmark"
              size={15}
              color={BRAND.onPrimary}
            />
          ) : null}
        </View>
        <Text style={[setupStyles.consentText, { color: colors.text }]}>
          I agree to share my BVN with PiggyVest for wallet identity
          verification.
        </Text>
      </Pressable>
      {error ? (
        <Text
          accessibilityRole="alert"
          style={[setupStyles.error, { color: colors.error }]}
        >
          {error}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Create account number"
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        onPress={submit}
        style={[setupStyles.submit, { backgroundColor: BRAND.primary }]}
      >
        {busy ? (
          <ActivityIndicator color={BRAND.onPrimary} />
        ) : (
          <Text style={[setupStyles.submitText, { color: BRAND.onPrimary }]}>
            Create account number
          </Text>
        )}
      </Pressable>
    </View>
  );
}
