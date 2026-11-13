import type { ReactNode } from 'react';
import { Pressable, Text } from 'react-native';
import type { CheckoutIdentityTheme } from '../colors';
import { styles } from './CheckoutCodeForm.styles';

export function CheckoutCodeFormActions({
  busy,
  onResend,
  onUseDifferentEmail,
  renderSocial,
  resendAfter,
  sentTo,
  socialBusy,
  theme,
}: {
  busy: boolean;
  onResend: () => void;
  onUseDifferentEmail: () => void;
  renderSocial: (busy: boolean) => ReactNode;
  resendAfter: number | null;
  sentTo: string;
  socialBusy: boolean;
  theme: CheckoutIdentityTheme;
}) {
  if (!sentTo) return renderSocial(busy);
  const cooldownActive = resendAfter !== null && resendAfter > Date.now();
  const remainingSeconds = cooldownActive
    ? Math.max(1, Math.ceil((resendAfter - Date.now()) / 1_000))
    : 0;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          cooldownActive
            ? `You can resend a code in ${remainingSeconds} seconds.`
            : 'Resend code'
        }
        disabled={busy || cooldownActive}
        accessibilityState={{ disabled: busy || cooldownActive }}
        onPress={onResend}
      >
        <Text
          style={[
            styles.changeEmail,
            { color: cooldownActive ? theme.mutedText : theme.primary },
          ]}
        >
          {cooldownActive
            ? `Resend code in ${remainingSeconds}s`
            : 'Resend code'}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={busy || socialBusy}
        accessibilityState={{ disabled: busy || socialBusy }}
        onPress={onUseDifferentEmail}
      >
        <Text style={[styles.changeEmail, { color: theme.text }]}>
          Use a different email
        </Text>
      </Pressable>
    </>
  );
}
