import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { z } from 'zod';
import { useAuthStore } from '@/stores/auth-store';
import type { CheckoutIdentityTheme } from '../colors';
import { ErrorAlert } from './ErrorAlert';

const emailSchema = z.email();
const resendCooldownsByEmail = new Map<string, number>();

function getResendCooldown(email: string): number | null {
  const until = resendCooldownsByEmail.get(email);
  if (!until) return null;
  if (until > Date.now()) return until;
  resendCooldownsByEmail.delete(email);
  return null;
}

function startResendCooldown(email: string): number {
  const until = Date.now() + 60_000;
  resendCooldownsByEmail.set(email, until);
  setTimeout(() => {
    if (resendCooldownsByEmail.get(email) === until) {
      resendCooldownsByEmail.delete(email);
    }
  }, 60_000);
  return until;
}

export function CheckoutCodeForm({
  renderSocial,
  onVerified,
  onBusyChange,
  socialBusy,
  theme,
}: {
  renderSocial: (busy: boolean) => ReactNode;
  onVerified: () => void;
  onBusyChange: (busy: boolean) => void;
  socialBusy: boolean;
  theme: CheckoutIdentityTheme;
}) {
  const sendCode = useAuthStore((state) => state.signInWithOtp);
  const verifyCode = useAuthStore((state) => state.verifyOtp);
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [code, setCode] = useState('');
  const [resendAfterByEmail, setResendAfterByEmail] = useState<
    Record<string, number>
  >({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(false);
  const pending = useRef(false);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const normalizedEmail = email.trim().toLowerCase();
  const isEmailValid = emailSchema.safeParse(normalizedEmail).success;
  const activeEmail = sentTo || normalizedEmail;
  const resendAfter =
    resendAfterByEmail[activeEmail] ?? getResendCooldown(activeEmail);
  const emailCoolingDown =
    !sentTo && isEmailValid && resendAfter !== null && resendAfter > Date.now();

  useEffect(() => {
    if (resendAfter === null) return;
    const timer = setTimeout(
      () => {
        setResendAfterByEmail((current) => {
          if (current[activeEmail] !== resendAfter) return current;
          const next = { ...current };
          delete next[activeEmail];
          return next;
        });
      },
      Math.max(0, resendAfter - Date.now())
    );
    return () => clearTimeout(timer);
  }, [activeEmail, resendAfter]);

  const submit = async (resend = false) => {
    if (
      pending.current ||
      socialBusy ||
      (resend && resendAfter !== null) ||
      (!resend &&
        !sentTo &&
        (getResendCooldown(normalizedEmail) ?? 0) > Date.now())
    )
      return;
    if (sentTo ? !resend && code.length !== 6 : !isEmailValid) return;

    pending.current = true;
    setBusy(true);
    onBusyChange(true);
    setError(null);
    try {
      const result =
        sentTo && !resend
          ? await verifyCode(sentTo, code)
          : await sendCode(sentTo || normalizedEmail);
      if (!active.current) return;
      if (!result.success) {
        setError(result.error || 'Unable to sign in. Please try again.');
      } else if (sentTo && !resend) {
        onVerified();
      } else {
        setSentTo(sentTo || normalizedEmail);
        setCode('');
        const resendAfter = startResendCooldown(sentTo || normalizedEmail);
        setResendAfterByEmail((current) => ({
          ...current,
          [sentTo || normalizedEmail]: resendAfter,
        }));
      }
    } catch {
      if (active.current) setError('Unable to sign in. Please try again.');
    } finally {
      pending.current = false;
      if (active.current) {
        onBusyChange(false);
        setBusy(false);
      }
    }
  };

  const inputLabel = sentTo ? 'Verification code' : 'Email address';
  const submitLabel = sentTo
    ? 'Verify & continue checkout'
    : 'Continue with email';
  const disabled =
    busy ||
    socialBusy ||
    (sentTo ? code.length !== 6 : !isEmailValid || emailCoolingDown);

  return (
    <View style={styles.form}>
      {sentTo ? (
        <Text style={[styles.helpText, { color: theme.mutedText }]}>
          Enter the code sent to {sentTo}.
        </Text>
      ) : null}
      <ErrorAlert error={error} theme={theme} />
      <View style={styles.field}>
        <Text style={[styles.label, { color: theme.text }]}>{inputLabel}</Text>
        <TextInput
          key={inputLabel}
          accessibilityLabel={inputLabel}
          value={sentTo ? code : email}
          onChangeText={
            sentTo
              ? (value) => setCode(value.replace(/\D/g, '').slice(0, 6))
              : setEmail
          }
          placeholder={sentTo ? '000000' : 'you@example.com'}
          placeholderTextColor={theme.placeholder}
          editable={!busy && !socialBusy}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete={sentTo ? 'one-time-code' : 'email'}
          keyboardType={sentTo ? 'number-pad' : 'email-address'}
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
          style={[
            styles.input,
            {
              color: theme.text,
              backgroundColor: theme.input,
              borderColor: sentTo ? theme.border : theme.error,
              borderWidth: sentTo ? 1 : 1.5,
            },
          ]}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled, busy }}
        disabled={disabled}
        onPress={() => void submit()}
        style={[
          styles.submit,
          { backgroundColor: disabled ? theme.closeButton : theme.primary },
        ]}
      >
        <Text
          style={[
            styles.label,
            { color: disabled ? theme.mutedText : theme.primaryForeground },
          ]}
        >
          {busy ? (sentTo ? 'Verifying code…' : 'Sending code…') : submitLabel}
        </Text>
      </Pressable>
      {sentTo ? (
        <>
          <Pressable
            accessibilityRole="button"
            disabled={busy || resendAfter !== null}
            accessibilityState={{
              disabled: busy || resendAfter !== null,
            }}
            onPress={() => void submit(true)}
          >
            <Text
              style={[
                styles.changeEmail,
                {
                  color: resendAfter === null ? theme.primary : theme.mutedText,
                },
              ]}
            >
              {resendAfter === null
                ? 'Resend code'
                : 'Resend code unavailable during cooldown.'}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={busy || socialBusy}
            accessibilityState={{ disabled: busy || socialBusy }}
            onPress={() => {
              setSentTo('');
              setCode('');
              setError(null);
            }}
          >
            <Text style={[styles.changeEmail, { color: theme.text }]}>
              Use a different email
            </Text>
          </Pressable>
        </>
      ) : (
        renderSocial(busy)
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 12 },
  field: { gap: 6 },
  label: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  helpText: { fontFamily: 'Inter_400Regular' },
  input: {
    minHeight: 44,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
  },
  submit: {
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  changeEmail: {
    paddingVertical: 12,
    textDecorationLine: 'underline',
    fontFamily: 'Inter_400Regular',
  },
});
