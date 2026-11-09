import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, Text, View } from 'react-native';
import { styles } from './wallet.styles';

type WalletHeroLoyaltyPillProps = {
  loyaltyPoints: number;
  /** Display tier (Bronze already filtered out), shown when nothing to redeem. */
  visibleTier: string | null;
  onOpenRedeemPanel: () => void;
};

/**
 * Loyalty points in the wallet card's top-right corner. With points to spend
 * the whole pill opens the redemption panel and carries a Redeem chip;
 * otherwise it is a plain read-only label.
 */
export function WalletHeroLoyaltyPill({
  loyaltyPoints,
  visibleTier,
  onOpenRedeemPanel,
}: WalletHeroLoyaltyPillProps) {
  // Points are a non-negative whole number; never show '-5' or 'NaN'.
  const points = Number.isFinite(loyaltyPoints)
    ? Math.max(0, Math.floor(loyaltyPoints))
    : 0;
  const pointsLabel = `${points.toLocaleString()} pts`;
  const content = (
    <>
      <Ionicons
        accessible={false}
        importantForAccessibility="no"
        name="star"
        size={13}
        color="#F8B84C"
      />
      <Text style={styles.loyaltyPillText} numberOfLines={1}>
        {pointsLabel}
      </Text>
      {points > 0 ? (
        <View style={styles.redeemPill}>
          <Text style={styles.redeemPillText}>Redeem</Text>
        </View>
      ) : visibleTier ? (
        <Text style={styles.loyaltyPillTier}>{visibleTier}</Text>
      ) : null}
    </>
  );

  if (points > 0) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Redeem loyalty points"
        accessibilityHint={`You have ${pointsLabel}. Opens the loyalty redemption panel`}
        hitSlop={6}
        onPress={onOpenRedeemPanel}
        style={styles.loyaltyPill}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <View
      accessible
      accessibilityLabel={`Loyalty ${pointsLabel}${visibleTier ? `, ${visibleTier}` : ''}`}
      style={styles.loyaltyPill}
    >
      {content}
    </View>
  );
}
