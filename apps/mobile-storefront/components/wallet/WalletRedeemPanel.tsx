import { Text, TextInput, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import type Colors from '@/constants/Colors';
import { SPACING } from '@/constants/Colors';
import { WalletPanelActionButtons } from './WalletPanelActionButtons';
import { styles } from './wallet.styles';

type WalletColors = (typeof Colors)['light'];

export interface WalletRedeemPanelProps {
  colors: WalletColors;
  isRedeemPending: boolean;
  loyaltyPoints: number;
  minimumRedeemablePoints: number;
  onChangeRedeemPoints: (value: string) => void;
  onConfirmRedeem: () => void;
  onResetRedeem: () => void;
  redeemPoints: string;
}

export function WalletRedeemPanel({
  colors,
  isRedeemPending,
  loyaltyPoints,
  minimumRedeemablePoints,
  onChangeRedeemPoints,
  onConfirmRedeem,
  onResetRedeem,
  redeemPoints,
}: WalletRedeemPanelProps) {
  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      style={[
        styles.redeemPanel,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <Text style={[styles.redeemPanelTitle, { color: colors.text }]}>
        Redeem Loyalty Points
      </Text>
      <Text
        style={[
          styles.redeemPanelSubtitle,
          { color: colors.textSecondary, marginBottom: SPACING.md },
        ]}
      >
        Available: {loyaltyPoints.toLocaleString()} points
      </Text>

      <View
        style={[
          styles.infoCard,
          {
            backgroundColor: colors.muted,
            borderColor: colors.border,
            marginBottom: SPACING.md,
          },
        ]}
      >
        <Text style={[styles.infoCardTitle, { color: colors.text }]}>
          ✨ Loyalty Points Benefits
        </Text>

        <View style={styles.infoRow}>
          <Text style={styles.infoEmoji}>💵</Text>
          <Text style={[styles.infoText, { color: colors.textSecondary }]}>
            <Text style={{ fontWeight: 'bold', color: colors.text }}>
              Convert to Cash:
            </Text>{' '}
            100 points = ₦10. Redeem blocks of 100 points directly into your
            wallet.
          </Text>
        </View>

        {/*
          Loyalty points must NOT be advertised as buying quiz entry or a better
          leaderboard rank. Points are only ever earned by purchasing, so any
          such promise makes the quiz purchase-gated (consideration) and, with
          prizes at stake, a regulated promotional competition with no
          free-entry defence. Entry is free and ranking is neutral — see
          supabase/migrations/20260714102000_quiz_free_entry.sql and
          20260714102100_quiz_neutral_ranking.sql.
        */}
        <View style={styles.infoRow}>
          <Text style={styles.infoEmoji}>🏆</Text>
          <Text style={[styles.infoText, { color: colors.textSecondary }]}>
            <Text style={{ fontWeight: 'bold', color: colors.text }}>
              SuperQuiz Entry:
            </Text>{' '}
            Free to enter — no points needed. Play high-stake quiz events and
            win huge prizes!
          </Text>
        </View>

        <Text
          style={[
            styles.infoSubTitle,
            { color: colors.text, marginTop: SPACING.xs },
          ]}
        >
          Tier Rankings:
        </Text>
        <View style={styles.tierRow}>
          <Text style={[styles.tierBadge, { backgroundColor: '#7C2D12' }]}>
            BRONZE
          </Text>
          <Text style={[styles.tierBadge, { backgroundColor: '#4B5563' }]}>
            SILVER
          </Text>
          <Text style={[styles.tierBadge, { backgroundColor: '#D97706' }]}>
            GOLD
          </Text>
          <Text style={[styles.tierBadge, { backgroundColor: '#4F46E5' }]}>
            PLATINUM
          </Text>
        </View>
      </View>

      <TextInput
        accessibilityLabel="Points to redeem"
        style={[
          styles.redeemInput,
          {
            backgroundColor: colors.muted,
            borderColor: colors.border,
            color: colors.text,
          },
        ]}
        value={redeemPoints}
        onChangeText={onChangeRedeemPoints}
        keyboardType="number-pad"
        placeholder={`Enter points to redeem (min ${minimumRedeemablePoints})`}
        placeholderTextColor={colors.placeholder}
      />

      <WalletPanelActionButtons
        cancelAccessibilityLabel="Cancel redeem points"
        confirmAccessibilityLabel="Confirm redeem points"
        confirmText="Redeem"
        colors={colors}
        isPending={isRedeemPending}
        onCancel={onResetRedeem}
        onConfirm={onConfirmRedeem}
      />
    </Animated.View>
  );
}
