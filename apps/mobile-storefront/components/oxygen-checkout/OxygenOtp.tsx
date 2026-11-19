import Ionicons from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useOxygenColors } from './OxygenFormPrimitives';
import { OxygenOtpDigits } from './OxygenOtpDigits';
import { useOxygenOtpAnimation } from './oxygen-otp-animation';
import { type OxygenOtpProps, useOxygenOtp } from './use-oxygen-otp';
import { useOxygenOtpPendingMotion } from './use-oxygen-otp-pending-motion';
export function OxygenOtp(props: OxygenOtpProps) {
  const otp = useOxygenOtp(props);
  const colors = useOxygenColors();
  const [focused, setFocused] = useState(false);
  const animation = useOxygenOtpAnimation(props.confirmed, props.scopeKey);
  const rotation = useOxygenOtpPendingMotion(props.pending && !props.confirmed);
  const error = props.error || otp.resendError;
  const remaining = `${Math.floor(otp.remaining / 60)}:${String(otp.remaining % 60).padStart(2, '0')}`;
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={styles.heading}>
        {!props.confirmed ? (
          <View
            style={[
              styles.badge,
              { backgroundColor: colors.primaryLowOpacity },
            ]}
          >
            <Ionicons
              name={props.label ? 'mail-outline' : 'phone-portrait-outline'}
              size={25}
              color={colors.primary}
            />
            {props.pending ? (
              <Animated.View
                style={[
                  styles.ring,
                  {
                    pointerEvents: 'none',
                    borderColor: colors.primary,
                    borderRightColor: 'transparent',
                    borderBottomColor: 'transparent',
                    transform: [{ rotate: rotation }],
                  },
                ]}
              />
            ) : null}
          </View>
        ) : null}
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: colors.text }]}
        >
          {props.confirmed
            ? 'Code verified'
            : (props.label ?? 'Verify your phone')}
        </Text>
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.description, { color: colors.textSecondary }]}
        >
          {props.confirmed
            ? 'Your code has been confirmed by Oxygen.'
            : props.pending
              ? 'Confirming your code with Oxygen…'
              : otp.remaining <= 0 && props.onResend
                ? 'Your code has expired. Tap Resend code to continue.'
                : props.label
                  ? 'Enter the 6-digit code sent to your email.'
                  : 'Enter the 6-digit code sent to your phone.'}
        </Text>
      </View>
      <View style={{ gap: 10 }}>
        {!props.confirmed ? (
          <Text style={[styles.label, { color: colors.text }]}>
            Verification code
          </Text>
        ) : null}
        <View>
          <OxygenOtpDigits
            value={props.value}
            pending={props.pending}
            confirmed={props.confirmed}
            settled={animation.settled}
            progress={animation.progress}
            focused={focused}
            error={!!error}
          />
          {!animation.settled ? (
            <TextInput
              accessibilityLabel="Six-digit verification code"
              value={props.value}
              onChangeText={otp.change}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              editable={!props.pending && !props.confirmed && otp.remaining > 0}
              caretHidden
              selectionColor="transparent"
              style={styles.input}
            />
          ) : null}
        </View>
      </View>
      {error ? (
        <View
          style={[styles.error, { backgroundColor: colors.primaryLowOpacity }]}
        >
          <Ionicons
            name="alert-circle-outline"
            size={19}
            color={colors.error}
          />
          <Text
            accessibilityRole="alert"
            style={{
              color: colors.error,
              fontSize: 13,
              lineHeight: 20,
              flex: 1,
            }}
          >
            {error}
          </Text>
        </View>
      ) : null}
      {!props.confirmed ? (
        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
            {otp.remaining > 0 ? 'Need a new code?' : 'Code expired'}
          </Text>
          {otp.remaining > 0 ? (
            <Text
              style={{
                color: colors.textSecondary,
                fontSize: 13,
                fontVariant: ['tabular-nums'],
              }}
            >
              Resend in {remaining}
            </Text>
          ) : props.onResend ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Resend code"
              accessibilityState={{ disabled: props.pending || otp.resending }}
              disabled={props.pending || otp.resending}
              onPress={() => void otp.resend()}
              style={styles.resend}
            >
              <Text
                style={{
                  color: colors.primary,
                  fontWeight: '600',
                  fontSize: 14,
                }}
              >
                {otp.resending ? 'Sending code…' : 'Resend code'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
export type { OxygenOtpProps } from './use-oxygen-otp';

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 24, padding: 18, gap: 24 },
  heading: { alignItems: 'center', gap: 12, paddingTop: 8 },
  badge: {
    width: 58,
    height: 58,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: { position: 'absolute', inset: -4, borderWidth: 2, borderRadius: 24 },
  title: {
    fontSize: 23,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 30,
  },
  description: {
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    maxWidth: 320,
  },
  label: { fontSize: 13, fontWeight: '600' },
  input: {
    position: 'absolute',
    inset: 0,
    color: 'transparent',
    backgroundColor: 'transparent',
    fontSize: 1,
  },
  error: { flexDirection: 'row', gap: 8, padding: 12, borderRadius: 12 },
  footer: {
    borderTopWidth: 1,
    paddingTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    minHeight: 56,
    flexWrap: 'wrap',
  },
  resend: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
});
