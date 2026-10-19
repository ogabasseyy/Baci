import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, Text, View } from 'react-native';
import { BRAND } from '@/constants/Colors';
import { SWAP_ELIGIBLE_DEVICES, SWAP_HOW_IT_WORKS } from '@/lib/swap-utils';
import { swapScreenStyles as styles } from './swap-screen.styles';

type SwapColors = typeof import('@/constants/Colors').default['light'];

type SwapOverviewContentProps = {
  colors: SwapColors;
  onStartTradeIn: () => void;
};

export function SwapOverviewContent({
  colors,
  onStartTradeIn,
}: SwapOverviewContentProps) {
  return (
    <>
      <View style={styles.header}>
        <Ionicons name="swap-horizontal" size={28} color={BRAND.primary} />
        <View style={styles.headerText}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            Swap & Trade-in
          </Text>
          <Text
            style={[styles.headerSubtitle, { color: colors.textSecondary }]}
          >
            Upgrade to the latest tech for less
          </Text>
        </View>
      </View>

      <View style={styles.heroCard}>
        <View style={styles.heroBadge}>
          <Ionicons name="sparkles" size={12} color={colors.white} />
          <Text style={[styles.heroBadgeText, { color: colors.white }]}>
            Powered by Gemini AI
          </Text>
        </View>
        <Text style={[styles.heroTitle, { color: colors.white }]}>
          Get an Instant AI{'\n'}Valuation in Seconds
        </Text>
        <Text style={[styles.heroSubtitle, { color: colors.white }]}>
          Upload a short video of your device. Our AI will analyze the condition
          and give you an instant trade-in offer.
        </Text>
        <Pressable
          style={[styles.heroButton, { backgroundColor: colors.white }]}
          onPress={onStartTradeIn}
        >
          <Text style={[styles.heroButtonText, { color: BRAND.primary }]}>
            Start AI Trade-in
          </Text>
          <Ionicons name="camera" size={18} color={BRAND.primary} />
        </Pressable>
      </View>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>
        How it Works
      </Text>
      <View style={styles.stepsContainer}>
        {SWAP_HOW_IT_WORKS.map((step, index) => (
          <View
            key={step.title}
            style={[styles.stepCard, { backgroundColor: colors.card }]}
          >
            <View style={styles.stepIconContainer}>
              <Ionicons name={step.icon} size={24} color={BRAND.primary} />
            </View>
            <Text style={[styles.stepTitle, { color: colors.text }]}>
              {index + 1}. {step.title}
            </Text>
            <Text style={[styles.stepDesc, { color: colors.textSecondary }]}>
              {step.desc}
            </Text>
          </View>
        ))}
      </View>

      <View style={[styles.eligibleCard, { backgroundColor: colors.card }]}>
        <Text style={[styles.eligibleTitle, { color: colors.text }]}>
          What can you trade in?
        </Text>
        {SWAP_ELIGIBLE_DEVICES.map((device) => (
          <View key={device} style={styles.eligibleItem}>
            <View
              style={[styles.eligibleCheck, { backgroundColor: colors.muted }]}
            >
              <Ionicons name="checkmark" size={14} color={colors.success} />
            </View>
            <Text style={[styles.eligibleText, { color: colors.text }]}>
              {device}
            </Text>
          </View>
        ))}
      </View>

      <View
        style={[styles.sustainabilityCard, { backgroundColor: colors.muted }]}
      >
        <View
          style={[
            styles.sustainabilityIcon,
            { backgroundColor: colors.background },
          ]}
        >
          <Ionicons name="leaf" size={32} color={colors.success} />
        </View>
        <View style={styles.sustainabilityContent}>
          <View style={styles.sustainabilityHeader}>
            <Ionicons name="sync" size={18} color={colors.success} />
            <Text
              style={[styles.sustainabilityTitle, { color: colors.success }]}
            >
              Trade-in is Recycling
            </Text>
          </View>
          <Text
            style={[styles.sustainabilityText, { color: colors.textSecondary }]}
          >
            By swapping your device, you keep e-waste out of landfills. We
            refurbish and re-home your old gadgets, extending their lifecycle.
            It&apos;s a win for your wallet and the planet.
          </Text>
        </View>
      </View>
    </>
  );
}
