import Ionicons from '@react-native-vector-icons/ionicons';
import { type ComponentProps, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { BRAND } from '@/constants/Colors';
import { PiggyvestPrimaryWalletSchemas } from '@/schemas/piggyvest-primary-wallet';
import { setupStyles } from './piggyvest-wallet-setup.styles';
import { BvnField } from './setup/BvnField';
import { describeSetupError } from './setup/describe-setup-error';

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
  // Each message sits under what it is about: the BVN field, the consent
  // box, or (for server answers) the form.
  const [bvnError, setBvnError] = useState<string | null>(null);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const formValid = bvn.length === 11 && consent;
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
      const issue = parsed.error.issues[0];
      const message = issue?.message ?? 'Check your setup details.';
      if (issue?.path[0] === 'consent') setConsentError(message);
      else setBvnError(message);
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError(null);
    setBvnError(null);
    try {
      await onSubmit(parsed.data);
      // Clear only after the setup is confirmed: a failure keeps the BVN
      // for correction-free retry, while success drops the sensitive
      // value from state at the earliest safe moment.
      setBvn('');
    } catch (error) {
      const outcome = describeSetupError(error);
      // A rejected number is dropped: it cannot be retried as it is.
      if (outcome.clearBvn) setBvn('');
      if (outcome.field === 'bvn') setBvnError(outcome.message);
      else setError(outcome.message);
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
          Set up your savings wallet
        </Text>
        <Text style={[setupStyles.subtitle, { color: colors.textSecondary }]}>
          PiggyVest, our savings partner, needs your BVN to verify you and
          create your account number.
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
      <BvnField
        colors={colors}
        value={bvn}
        onChange={(digits) => {
          setBvn(digits);
          setBvnError(null);
        }}
        error={bvnError}
        editable={!busy}
      />
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel="Agree to PiggyVest identity verification"
        accessibilityState={{ checked: consent, disabled: busy }}
        disabled={busy}
        onPress={() => {
          setConsent(!consent);
          setConsentError(null);
        }}
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
      {consentError ? (
        <Text
          accessibilityRole="alert"
          style={[setupStyles.error, { color: colors.error }]}
        >
          {consentError}
        </Text>
      ) : null}
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
        accessibilityState={{ disabled: busy || !formValid, busy }}
        // Disabled (and dimmed) until an 11-digit BVN and consent are given.
        disabled={busy || !formValid}
        onPress={submit}
        style={[
          setupStyles.submit,
          {
            backgroundColor: BRAND.primary,
            opacity: busy || formValid ? 1 : 0.45,
          },
        ]}
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
