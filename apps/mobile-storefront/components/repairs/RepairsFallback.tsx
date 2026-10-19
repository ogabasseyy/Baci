import Ionicons from '@react-native-vector-icons/ionicons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import {
  buildRepairWhatsappUrl,
  REPAIR_SERVICES,
  REPAIR_WORKFLOW_STEPS,
} from '@/components/repairs/repairs-content';
import { repairsScreenStyles as styles } from '@/components/repairs/repairs-screen.styles';
import { useColorScheme } from '@/components/useColorScheme';
import Colors, { BRAND } from '@/constants/Colors';
import { SUPPORT_WHATSAPP_PHONE } from '@/constants/Support';

const handleBookRepair = (service?: string): void => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  Linking.openURL(buildRepairWhatsappUrl(SUPPORT_WHATSAPP_PHONE, service));
};

const handleSwap = (): void => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  router.push('/swap');
};

/**
 * Pre-catalogue repair experience: WhatsApp-only booking. Rendered by
 * `app/repairs/index.tsx` when the merchant's repairs catalogue is
 * unavailable (feature flag off, or the read API 404s) — this is today's
 * unchanged behaviour, kept verbatim so nothing regresses for merchants
 * without a catalogue yet. Also reused as the "Device not listed?" secondary
 * path from the catalogue screen (`RepairDeviceCatalog`).
 */
export function RepairsFallback() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = Colors[colorScheme ?? 'light'];

  return (
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Hero Card ── */}
      <View style={styles.heroCard}>
        <View style={styles.heroBadge}>
          <Ionicons name="shield-checkmark" size={12} color="#FFF" />
          <Text style={styles.heroBadgeText}>Certified Technicians</Text>
        </View>
        <Text style={styles.heroTitle}>Don't Replace It.{'\n'}Repair It.</Text>
        <Text style={styles.heroSubtitle}>
          Expert repairs with genuine parts. Every device fixed is one less in a
          landfill — saving you money and the planet.
        </Text>
        <Pressable
          style={styles.heroButton}
          onPress={() => handleBookRepair()}
          accessibilityRole="button"
          accessibilityLabel="Book a Repair"
          accessibilityHint="Opens WhatsApp to schedule a repair with a technician"
        >
          <Text style={styles.heroButtonText}>Book a Repair</Text>
          <Ionicons name="arrow-forward" size={18} color={BRAND.primary} />
        </Pressable>
      </View>

      {/* ── How It Works ── */}
      <Text style={[styles.sectionTitle, { color: colors.text }]}>
        How it Works
      </Text>
      <View style={styles.stepsContainer}>
        {REPAIR_WORKFLOW_STEPS.map((step, index) => (
          <View
            key={step.title}
            style={[styles.stepCard, { backgroundColor: colors.card }]}
          >
            <View style={styles.stepIconContainer}>
              <Ionicons name={step.icon} size={24} color={BRAND.primary} />
            </View>
            <View style={styles.stepTextContainer}>
              <Text style={[styles.stepTitle, { color: colors.text }]}>
                {index + 1}. {step.title}
              </Text>
              <Text style={[styles.stepDesc, { color: colors.textSecondary }]}>
                {step.desc}
              </Text>
            </View>
          </View>
        ))}
      </View>

      {/* ── Services ── */}
      <Text style={[styles.sectionTitle, { color: colors.text }]}>
        Our Services
      </Text>
      <View style={styles.servicesList}>
        {REPAIR_SERVICES.map((service) => (
          <Pressable
            key={service.title}
            style={[styles.serviceCard, { backgroundColor: colors.card }]}
            onPress={() => handleBookRepair(service.title)}
            accessibilityRole="button"
            accessibilityLabel={`${service.title}, ${service.price}`}
            accessibilityHint={`Inquire about ${service.title} repair`}
          >
            <View style={styles.serviceIconContainer}>
              <Ionicons name={service.icon} size={22} color={BRAND.primary} />
            </View>
            <View style={styles.serviceContent}>
              <Text style={[styles.serviceTitle, { color: colors.text }]}>
                {service.title}
              </Text>
              <Text
                style={[styles.serviceDesc, { color: colors.textSecondary }]}
              >
                {service.desc}
              </Text>
            </View>
            <View style={styles.servicePriceBadge}>
              <Text style={styles.servicePriceText}>{service.price}</Text>
            </View>
          </Pressable>
        ))}
      </View>

      {/* ── Free Cleaning Banner ── */}
      <View
        style={[
          styles.freeBanner,
          { backgroundColor: isDark ? 'rgba(5, 150, 105, 0.12)' : '#ECFDF5' },
        ]}
      >
        <View
          style={[
            styles.freeBannerIcon,
            { backgroundColor: isDark ? 'rgba(5, 150, 105, 0.2)' : '#D1FAE5' },
          ]}
        >
          <Ionicons
            name="sparkles"
            size={24}
            color={isDark ? '#34D399' : '#059669'}
          />
        </View>
        <View style={styles.freeBannerContent}>
          <Text style={[styles.freeBannerTitle, { color: colors.text }]}>
            Free Port & Speaker Cleaning
          </Text>
          <Text
            style={[styles.freeBannerDesc, { color: colors.textSecondary }]}
          >
            Often, a "broken" port is just dirty. Visit us for a{' '}
            <Text style={{ fontWeight: '700' }}>free cleaning</Text> — no
            appointment needed.
          </Text>
        </View>
      </View>

      {/* ── Trade-in CTA ── */}
      <View style={[styles.tradeinCard, { backgroundColor: colors.card }]}>
        <View style={styles.tradeinContent}>
          <Ionicons name="swap-horizontal" size={24} color={BRAND.primary} />
          <View style={styles.tradeinText}>
            <Text style={[styles.tradeinTitle, { color: colors.text }]}>
              Beyond Repair?
            </Text>
            <Text style={[styles.tradeinDesc, { color: colors.textSecondary }]}>
              Trade in your old device for credit toward a new one.
            </Text>
          </View>
        </View>
        <Pressable
          style={styles.tradeinButton}
          onPress={handleSwap}
          accessibilityRole="button"
          accessibilityLabel="Trade-in your device"
          accessibilityHint="Navigate to Swap and Trade-in page"
        >
          <Text style={styles.tradeinButtonText}>Trade-in</Text>
          <Ionicons name="arrow-forward" size={16} color={BRAND.primary} />
        </Pressable>
      </View>
    </ScrollView>
  );
}
