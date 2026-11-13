import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  Text,
  TextInput,
  type TextInputInstance,
  View,
} from 'react-native';
import { checkoutIdentityEmailSchema } from '@/schemas/checkout-identity-email';
import { useAuthStore } from '@/stores/auth-store';
import type { CheckoutIdentityTheme } from '../colors';
import { styles } from './CheckoutCodeForm.styles';
import { CheckoutCodeFormActions } from './CheckoutCodeFormActions';
import type { OtpSendResult } from './checkout-otp-state';
import { checkoutOtpState } from './checkout-otp-state';
import { ErrorAlert } from './ErrorAlert';

export function CheckoutCodeForm({
  renderSocial,
  onVerified,
  onBusyChange,
  onVerificationBusyChange,
  socialBusy,
  theme,
}: {
  renderSocial: (busy: boolean) => ReactNode;
  onVerified: () => void;
  onBusyChange: (busy: boolean) => void;
  onVerificationBusyChange: (busy: boolean) => void;
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
  const [, setCooldownVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInputInstance>(null);
  const active = useRef(false);
  const pending = useRef(false);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const normalizedEmail = email.trim().toLowerCase();
  const isEmailValid =
    checkoutIdentityEmailSchema.safeParse(normalizedEmail).success;
  const activeEmail = sentTo || normalizedEmail;
  const canResumeOtp = !sentTo && checkoutOtpState.hasPending(normalizedEmail);
  const pendingSend = !sentTo
    ? checkoutOtpState.getInFlightSend(normalizedEmail)
    : undefined;
  const isSendInProgress = pendingSend !== undefined;
  const resendAfter =
    resendAfterByEmail[activeEmail] ??
    checkoutOtpState.getResendCooldown(activeEmail);
  const emailCoolingDown =
    !sentTo && isEmailValid && resendAfter !== null && resendAfter > Date.now();

  useEffect(() => {
    if (resendAfter === null) return;
    const timer = setTimeout(
      () => {
        setResendAfterByEmail((current) => {
          if (current[activeEmail] === resendAfter) {
            const next = { ...current };
            delete next[activeEmail];
            return next;
          }
          return current;
        });
        setCooldownVersion((version) => version + 1);
      },
      Math.max(0, resendAfter - Date.now())
    );
    const countdown = setInterval(
      () => setCooldownVersion((version) => version + 1),
      1_000
    );
    return () => {
      clearTimeout(timer);
      clearInterval(countdown);
    };
  }, [activeEmail, resendAfter]);

  useEffect(() => {
    if (sentTo) inputRef.current?.focus();
  }, [sentTo]);

  useEffect(() => {
    if (!pendingSend) return;
    let subscribed = true;
    void pendingSend.then(
      ({ result, cooldownUntil }) => {
        if (!subscribed) return;
        if (!result.success) {
          setError(result.error || 'Unable to sign in. Please try again.');
          return;
        }
        if (cooldownUntil === null) return;
        setSentTo(normalizedEmail);
        setResendAfterByEmail((current) => ({
          ...current,
          [normalizedEmail]: cooldownUntil,
        }));
      },
      () => {
        if (subscribed) {
          setError('Unable to sign in. Please try again.');
        }
      }
    );
    return () => {
      subscribed = false;
    };
  }, [normalizedEmail, pendingSend]);

  const submit = async (resend = false) => {
    if (
      pending.current ||
      socialBusy ||
      (!sentTo && isSendInProgress) ||
      (resend && resendAfter !== null && resendAfter > Date.now()) ||
      (resend && !sentTo) ||
      (!resend &&
        !sentTo &&
        !canResumeOtp &&
        (checkoutOtpState.getResendCooldown(normalizedEmail) ?? 0) > Date.now())
    )
      return;
    if (!sentTo && !resend && checkoutOtpState.hasPending(normalizedEmail)) {
      setSentTo(normalizedEmail);
      setCode('');
      setError(null);
      return;
    }
    if (sentTo ? !resend && code.length !== 6 : !isEmailValid) return;

    pending.current = true;
    setBusy(true);
    onBusyChange(true);
    const verifying = Boolean(sentTo && !resend);
    if (verifying) onVerificationBusyChange(true);
    setError(null);
    try {
      let result: OtpSendResult;
      const sentEmail = sentTo || normalizedEmail;
      let successfulSendCooldown: number | null = null;
      if (sentTo && !resend) {
        result = await verifyCode(sentTo, code);
      } else {
        const outcome = await checkoutOtpState.sendOnce(sentEmail, sendCode);
        result = outcome.result;
        successfulSendCooldown = outcome.cooldownUntil;
      }
      if (result.success && sentTo && !resend) {
        checkoutOtpState.clear(sentTo);
      }
      if (!active.current) return;
      if (!result.success) {
        setError(result.error || 'Unable to sign in. Please try again.');
      } else if (sentTo && !resend) {
        onVerified();
      } else {
        setSentTo(sentEmail);
        setCode('');
        const resendAfter = successfulSendCooldown;
        if (resendAfter === null) return;
        setResendAfterByEmail((current) => ({
          ...current,
          [sentEmail]: resendAfter,
        }));
      }
    } catch {
      if (active.current) setError('Unable to sign in. Please try again.');
    } finally {
      pending.current = false;
      if (active.current) {
        if (verifying) onVerificationBusyChange(false);
        onBusyChange(false);
        setBusy(false);
      }
    }
  };

  const inputLabel = sentTo ? 'Verification code' : 'Email address';
  const submitLabel = sentTo
    ? 'Verify & continue checkout'
    : canResumeOtp
      ? 'Enter verification code'
      : isSendInProgress
        ? 'Sending code…'
        : 'Continue with email';
  const disabled =
    busy ||
    socialBusy ||
    (!sentTo && isSendInProgress) ||
    (sentTo
      ? code.length !== 6
      : !isEmailValid || (emailCoolingDown && !canResumeOtp));

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
          ref={inputRef}
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
              // Primary red marks the focused email path; validation errors are shown
              // separately, and incomplete addresses keep the button disabled.
              borderColor: sentTo ? theme.border : theme.primary,
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
      <CheckoutCodeFormActions
        busy={busy}
        onResend={() => void submit(true)}
        onUseDifferentEmail={() => {
          setSentTo('');
          setCode('');
          setError(null);
        }}
        renderSocial={renderSocial}
        resendAfter={resendAfter}
        sentTo={sentTo}
        socialBusy={socialBusy}
        theme={theme}
      />
    </View>
  );
}
