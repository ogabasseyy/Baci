import Ionicons from '@react-native-vector-icons/ionicons';
import { router } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SPACING } from '@/constants/Colors';
import { WALLET_FUNDING_CHECKING_STATE_ENABLED } from '@/constants/wallet-funding';
import type { WalletCreditWatch } from '@/hooks/use-wallet-credit-watch';
import { getWalletCreditStatusCopy } from './wallet-credit-status.helpers';

const ARM_CHECK_LABEL = "I've transferred — check for it";
const CHECK_AGAIN_LABEL = 'Check again';
const DONE_LABEL = 'Done';
const RETURN_CTA_LABEL = 'Return to your purchase';

interface WalletCreditCheckPanelProps {
  accentColor: string;
  textColor: string;
  watch: WalletCreditWatch;
}

/**
 * Post-transfer acknowledgement affordance shared by the wallet hero pill and
 * the Add Money panel. Self-hides while the dark-launch kill-switch is off so
 * callers can render it unconditionally. Never auto-submits anything — the
 * customer explicitly arms the check and explicitly taps to return.
 */
export function WalletCreditCheckPanel({
  accentColor,
  textColor,
  watch,
}: WalletCreditCheckPanelProps) {
  if (!WALLET_FUNDING_CHECKING_STATE_ENABLED) {
    return null;
  }

  const { armCheck, creditedAmount, reset, returnCtaHref, status } = watch;

  if (status === 'idle') {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={ARM_CHECK_LABEL}
        onPress={armCheck}
        style={[styles.armButton, { borderColor: accentColor }]}
      >
        <Ionicons name="sync-outline" size={16} color={accentColor} />
        <Text style={[styles.armButtonText, { color: accentColor }]}>
          {ARM_CHECK_LABEL}
        </Text>
      </Pressable>
    );
  }

  const copy = getWalletCreditStatusCopy({ creditedAmount, status });
  if (!copy) {
    return null;
  }

  return (
    <View style={styles.statusCard}>
      <View style={styles.statusHeader}>
        {status === 'checking' ? (
          <ActivityIndicator size="small" color={accentColor} />
        ) : (
          <Ionicons name={copy.icon} size={18} color={accentColor} />
        )}
        <Text style={[styles.statusTitle, { color: textColor }]}>
          {copy.title}
        </Text>
      </View>
      <Text style={[styles.statusMessage, { color: textColor }]}>
        {copy.message}
      </Text>
      {status === 'credited' && returnCtaHref ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={RETURN_CTA_LABEL}
          onPress={() => router.push(returnCtaHref)}
          style={[styles.ctaButton, { backgroundColor: accentColor }]}
        >
          <Text style={styles.ctaButtonText}>{RETURN_CTA_LABEL}</Text>
        </Pressable>
      ) : null}
      {status === 'credited' ? (
        // Returns the panel to idle so a later transfer from this same mounted
        // screen can arm a fresh check.
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={DONE_LABEL}
          onPress={reset}
          style={[styles.armButton, { borderColor: accentColor }]}
        >
          <Text style={[styles.armButtonText, { color: accentColor }]}>
            {DONE_LABEL}
          </Text>
        </Pressable>
      ) : null}
      {status === 'timedOut' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={CHECK_AGAIN_LABEL}
          onPress={armCheck}
          style={[styles.armButton, { borderColor: accentColor }]}
        >
          <Ionicons name="refresh-outline" size={16} color={accentColor} />
          <Text style={[styles.armButtonText, { color: accentColor }]}>
            {CHECK_AGAIN_LABEL}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  armButton: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    marginTop: SPACING.sm,
    minHeight: 44,
    paddingHorizontal: SPACING.md,
    paddingVertical: 8,
  },
  armButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
  ctaButton: {
    alignItems: 'center',
    borderRadius: 10,
    justifyContent: 'center',
    marginTop: SPACING.sm,
    minHeight: 44,
    paddingHorizontal: SPACING.md,
    paddingVertical: 10,
  },
  ctaButtonText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '700',
  },
  statusCard: {
    gap: 4,
    marginTop: SPACING.sm,
  },
  statusHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  statusMessage: {
    fontSize: 12,
    lineHeight: 18,
    opacity: 0.85,
  },
  statusTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
});
