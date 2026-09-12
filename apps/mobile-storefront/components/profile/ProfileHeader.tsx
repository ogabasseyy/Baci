import Ionicons from '@react-native-vector-icons/ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import type { Href } from 'expo-router';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInRight,
} from 'react-native-reanimated';
import { BRAND, palette, RADIUS, SPACING } from '@/constants/Colors';
import type { Customer } from '@/stores/auth-store';
import { useQuizBadgeStore } from '@/stores/quiz-badge-store';
import { ProfileQuizBadge } from './ProfileQuizBadge';

interface ProfileHeaderProps {
  customer: Customer;
  loyaltyPoints?: number;
}

function getTierInfo(tier?: string) {
  switch (tier?.toLowerCase()) {
    case 'gold':
      return { label: 'Gold', color: '#D4AF37', bg: '#D4AF3720' };
    case 'silver':
      return { label: 'Silver', color: '#A8A9AD', bg: '#A8A9AD20' };
    case 'platinum':
      return { label: 'Platinum', color: '#E5E4E2', bg: '#E5E4E218' };
    default:
      return {
        label: 'Member',
        color: palette.amber[500],
        bg: `${palette.amber[500]}18`,
      };
  }
}

export function ProfileHeader({ customer, loyaltyPoints }: ProfileHeaderProps) {
  const tier = getTierInfo();
  const latestQuizBadge = useQuizBadgeStore((state) =>
    state.getMostRecentBadge(customer.user_id ?? customer.id)
  );
  const initials =
    customer.first_name?.[0]?.toUpperCase() ||
    customer.email?.[0]?.toUpperCase() ||
    'U';
  const emailLocalPart = customer.email?.split('@')[0] ?? '';
  const displayName = customer.first_name
    ? `${customer.first_name} ${customer.last_name || ''}`.trim()
    : emailLocalPart
      ? emailLocalPart.charAt(0).toUpperCase() + emailLocalPart.slice(1)
      : 'Store Member';

  return (
    <Animated.View entering={FadeIn.duration(500)} style={styles.container}>
      <LinearGradient
        colors={[BRAND.primary, BRAND.primaryDark, '#1a0505']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/* Edit button */}
      <Animated.View
        entering={FadeInRight.delay(300).duration(400)}
        style={styles.editWrap}
      >
        <Pressable
          style={({ pressed }) => [
            styles.editBtn,
            pressed && { backgroundColor: 'rgba(255,255,255,0.25)' },
          ]}
          onPress={() => router.push('/profile/edit' as Href)}
          accessibilityRole="button"
          accessibilityLabel="Edit profile"
        >
          <Ionicons name="create-outline" size={18} color="#FFFFFF" />
        </Pressable>
      </Animated.View>

      {/* Avatar + Name */}
      <Animated.View
        entering={FadeInDown.delay(150).duration(500)}
        style={styles.row}
      >
        <View style={styles.avatarFallback}>
          <Text style={styles.initials}>{initials}</Text>
        </View>

        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={1}>
            {displayName}
          </Text>
          <Text style={styles.email} numberOfLines={1}>
            {customer.email}
          </Text>
          <View style={[styles.tierBadge, { backgroundColor: tier.bg }]}>
            <Ionicons name="star" size={10} color={tier.color} />
            <Text style={[styles.tierLabel, { color: tier.color }]}>
              {tier.label}
            </Text>
          </View>
          {latestQuizBadge ? (
            <ProfileQuizBadge
              eventTitle={latestQuizBadge.eventTitle}
              label={latestQuizBadge.label}
            />
          ) : null}
        </View>
      </Animated.View>

      {/* Loyalty points card */}
      {loyaltyPoints !== undefined && (
        <Animated.View
          entering={FadeInDown.delay(350).duration(500)}
          style={styles.pointsCard}
        >
          <View style={styles.pointsLeft}>
            <View style={styles.sparkle}>
              <Ionicons name="sparkles" size={18} color={palette.amber[400]} />
            </View>
            <View>
              <Text style={styles.pointsLabel}>Reward Points</Text>
              <Text style={styles.pointsValue}>
                {loyaltyPoints.toLocaleString()}
              </Text>
            </View>
          </View>
          <Pressable
            style={({ pressed }) => [
              styles.redeemBtn,
              pressed && { opacity: 0.8 },
            ]}
            onPress={() => router.push('/wallet' as Href)}
            accessibilityRole="button"
            accessibilityLabel="View wallet and redeem points"
          >
            <Text style={styles.redeemText}>Redeem</Text>
            <Ionicons
              name="arrow-forward"
              size={14}
              color={palette.amber[900]}
            />
          </Pressable>
        </Animated.View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: SPACING.md,
    borderRadius: RADIUS['3xl'],
    overflow: 'hidden',
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.lg,
    paddingHorizontal: SPACING.lg,
  },
  editWrap: {
    position: 'absolute',
    top: SPACING.md,
    right: SPACING.md,
    zIndex: 10,
  },
  editBtn: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.xl,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 24,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.3)',
    marginRight: SPACING.md,
  },
  avatarFallback: {
    width: 72,
    height: 72,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.md,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  initials: {
    fontSize: 28,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  info: { flex: 1 },
  name: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
    marginBottom: 2,
  },
  email: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.65)',
    marginBottom: SPACING.sm,
  },
  tierBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: RADIUS.full,
  },
  tierLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  pointsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: RADIUS['2xl'],
    paddingVertical: 14,
    paddingHorizontal: SPACING.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  pointsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sparkle: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.lg,
    backgroundColor: `${palette.amber[500]}25`,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pointsLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
    fontWeight: '500',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  pointsValue: {
    fontSize: 20,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  redeemBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: palette.amber[400],
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: RADIUS.full,
  },
  redeemText: {
    fontSize: 12,
    fontWeight: '800',
    color: palette.amber[900],
  },
});
