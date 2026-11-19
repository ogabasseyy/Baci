import Ionicons from '@react-native-vector-icons/ionicons';
import { useEffect } from 'react';
import {
  Pressable,
  type StyleProp,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import type Colors from '@/constants/Colors';
import { BRAND, withAlpha } from '@/constants/Colors';
import { useAuthStore } from '@/stores/auth-store';
import { answerWalletFundPrompt } from './answer-wallet-fund-prompt';
import { useWalletFundPromptStore } from './wallet-fund-prompt-store';

type WalletColors = (typeof Colors)['light'];

/**
 * The waiting funding question as a calm inline card with two answers.
 * Another account signing in declines it instead of showing it to them.
 */
export function WalletFundPromptCard({
  colors,
  style,
}: {
  colors: WalletColors;
  style?: StyleProp<ViewStyle>;
}) {
  const prompt = useWalletFundPromptStore((state) => state.prompt);
  const userId = useAuthStore((state) => state.user?.id ?? '');
  const merchantId = useAuthStore((state) => state.merchantId ?? '');
  const foreign = prompt !== null && prompt.scope !== `${userId}:${merchantId}`;
  useEffect(() => {
    if (foreign) answerWalletFundPrompt(false);
  }, [foreign]);
  if (!prompt || foreign) return null;
  return (
    <View
      accessibilityLiveRegion="polite"
      testID="wallet-fund-prompt"
      style={[
        styles.card,
        { backgroundColor: withAlpha(colors.primary, 0.08) },
        style,
      ]}
    >
      <View style={styles.header}>
        <Ionicons name="help-circle" size={20} color={colors.primary} />
        <Text style={[styles.title, { color: colors.text }]}>
          {prompt.title}
        </Text>
      </View>
      <Text style={[styles.message, { color: colors.textSecondary }]}>
        {prompt.message}
      </Text>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          onPress={() => answerWalletFundPrompt(false)}
          style={[styles.button, { backgroundColor: colors.muted }]}
        >
          <Text style={[styles.buttonText, { color: colors.text }]}>
            Not now
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => answerWalletFundPrompt(true)}
          style={[styles.button, { backgroundColor: colors.primary }]}
        >
          <Text style={[styles.buttonText, { color: BRAND.onPrimary }]}>
            {prompt.confirmLabel}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, gap: 8, padding: 14 },
  header: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  title: { flex: 1, fontSize: 14, fontWeight: '700' },
  message: { fontSize: 13, lineHeight: 19 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  button: {
    alignItems: 'center',
    borderRadius: 999,
    flex: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 12,
  },
  buttonText: { fontSize: 14, fontWeight: '700', textAlign: 'center' },
});
