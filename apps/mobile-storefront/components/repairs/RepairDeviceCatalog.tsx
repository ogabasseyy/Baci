import type {
  RepairDeviceBrandGroup,
  RepairDeviceSummary,
} from '@baci/shared/repairs';
import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { repairDeviceCatalogStyles } from '@/components/repairs/repair-device-catalog.styles';
import { repairsCatalogStyles } from '@/components/repairs/repairs-catalog.styles';
import { useColorScheme } from '@/components/useColorScheme';
import Colors, { BRAND } from '@/constants/Colors';

const styles = { ...repairsCatalogStyles, ...repairDeviceCatalogStyles };

interface RepairDeviceCatalogProps {
  groups: RepairDeviceBrandGroup[];
  brandGroups?: RepairDeviceBrandGroup[];
  query: string;
  onQueryChange: (query: string) => void;
  onSelectDevice: (device: RepairDeviceSummary) => void;
  onDescribeInstead: () => void;
  onChatWhatsapp: () => void;
}

/**
 * Device-first catalogue picker: a search bar + brand-grouped device cards
 * fed by `GET /api/storefront/[slug]/repairs/devices`. Selecting a device
 * drills into its quotes. The "Device not listed?" block keeps the free-text
 * booking path and the WhatsApp technician chat as secondary CTAs (WhatsApp
 * is a fallback, not the primary path anymore).
 */
export function RepairDeviceCatalog({
  groups,
  brandGroups = [],
  query,
  onQueryChange,
  onSelectDevice,
  onDescribeInstead,
  onChatWhatsapp,
}: RepairDeviceCatalogProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const heroForeground = colors.background;
  const hasResults = groups.some((group) => group.devices.length > 0);
  const brandShortcutGroups = brandGroups.length > 0 ? brandGroups : groups;

  return (
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <View
        style={[styles.heroCard, { backgroundColor: colors.text }]}
        accessibilityLabel="Premium device repair service"
      >
        <View style={styles.heroBadge}>
          <Ionicons name="sparkles" size={13} color={colors.background} />
          <Text style={[styles.heroBadgeText, { color: heroForeground }]}>
            PREMIUM SERVICE
          </Text>
        </View>
        <Text style={[styles.heroTitle, { color: heroForeground }]}>
          Don't Ditch It.{'\n'}
          <Text style={{ color: heroForeground }}>Fix It.</Text>
        </Text>
        <Text style={[styles.heroDescription, { color: heroForeground }]}>
          Certified technicians, genuine parts, and clear quotes for your
          device.
        </Text>
        <View style={styles.heroActions}>
          <View style={styles.heroPrimaryButtonBox}>
            <Pressable
              accessibilityLabel="Book a repair"
              accessibilityRole="button"
              onPress={onDescribeInstead}
              style={styles.heroPrimaryButton}
            >
              <Text style={styles.heroPrimaryButtonText}>Book a repair</Text>
              <Ionicons
                name="arrow-forward"
                size={17}
                color={colors.primaryForeground}
              />
            </Pressable>
          </View>
          <View style={styles.heroSecondaryButtonBox}>
            <Pressable
              accessibilityLabel="Chat with a technician"
              accessibilityRole="button"
              onPress={onChatWhatsapp}
              style={styles.heroSecondaryButton}
            >
              <Ionicons name="logo-whatsapp" size={16} color={heroForeground} />
              <Text
                style={[
                  styles.heroSecondaryButtonText,
                  { color: heroForeground },
                ]}
              >
                Chat
              </Text>
            </Pressable>
          </View>
        </View>
      </View>

      <View style={styles.trustRow}>
        <View style={styles.trustItem}>
          <Ionicons
            name="shield-checkmark-outline"
            size={16}
            color={BRAND.primary}
          />
          <Text style={[styles.trustText, { color: colors.textSecondary }]}>
            Certified
          </Text>
        </View>
        <View style={styles.trustItem}>
          <Ionicons
            name="checkmark-circle-outline"
            size={16}
            color={BRAND.primary}
          />
          <Text style={[styles.trustText, { color: colors.textSecondary }]}>
            Genuine parts
          </Text>
        </View>
        <View style={styles.trustItem}>
          <Ionicons name="pricetag-outline" size={16} color={BRAND.primary} />
          <Text style={[styles.trustText, { color: colors.textSecondary }]}>
            Clear quotes
          </Text>
        </View>
      </View>

      <Text style={[styles.introTitle, { color: colors.text }]}>
        Find your device
      </Text>
      <Text style={[styles.introSubtitle, { color: colors.textSecondary }]}>
        Choose a model to see available repair options and prices.
      </Text>

      <View style={[styles.searchBar, { borderColor: colors.border }]}>
        <Ionicons name="search" size={18} color={colors.textSecondary} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          placeholder="Search your device (e.g. iPhone 13)"
          placeholderTextColor={colors.placeholder}
          value={query}
          onChangeText={onQueryChange}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search for your device"
        />
      </View>

      {brandShortcutGroups.length > 0 ? (
        <View style={styles.brandRail}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
            Popular brands
          </Text>
          <ScrollView
            contentContainerStyle={styles.brandRailContent}
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            {brandShortcutGroups.map((group) => (
              <Pressable
                key={group.brand}
                style={[styles.brandChip, { backgroundColor: colors.muted }]}
                onPress={() => onQueryChange(group.brand)}
                accessibilityRole="button"
                accessibilityLabel={`Filter by ${group.brand}`}
              >
                <Text style={[styles.brandChipText, { color: colors.text }]}>
                  {group.brand}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {hasResults ? (
        groups.map((group) => (
          <View key={group.brand} style={styles.brandGroup}>
            <Text style={[styles.brandTitle, { color: colors.textSecondary }]}>
              {group.brand}
            </Text>
            {group.devices.map((device) => (
              <Pressable
                key={device.id}
                style={[styles.deviceCard, { backgroundColor: colors.card }]}
                onPress={() => onSelectDevice(device)}
                accessibilityRole="button"
                accessibilityLabel={`${device.brand} ${device.model}`}
                accessibilityHint="View repair options for this device"
              >
                <View style={styles.deviceThumb}>
                  <Ionicons
                    name="phone-portrait-outline"
                    size={22}
                    color={BRAND.primary}
                  />
                </View>
                <View style={styles.deviceInfo}>
                  <Text
                    style={[styles.deviceModel, { color: colors.text }]}
                    numberOfLines={1}
                  >
                    {device.model}
                  </Text>
                  {device.deviceType ? (
                    <Text
                      style={[
                        styles.deviceMeta,
                        { color: colors.textSecondary },
                      ]}
                    >
                      {device.deviceType}
                    </Text>
                  ) : null}
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={colors.textSecondary}
                />
              </Pressable>
            ))}
          </View>
        ))
      ) : (
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
          {query.trim()
            ? `No devices found for "${query.trim()}".`
            : 'No devices are listed yet.'}
        </Text>
      )}

      <View
        style={[
          styles.notListedCard,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.notListedTitle, { color: colors.text }]}>
          Device not listed?
        </Text>
        <Text style={[styles.notListedDesc, { color: colors.textSecondary }]}>
          Tell us about your device and the issue — we'll get back with a quote.
        </Text>
        <Pressable
          style={styles.secondaryButton}
          onPress={onDescribeInstead}
          accessibilityRole="button"
          accessibilityLabel="Describe your device instead"
        >
          <Ionicons name="create-outline" size={16} color={BRAND.primary} />
          <Text style={styles.secondaryButtonText}>Describe it instead</Text>
        </Pressable>
        <Pressable
          style={styles.secondaryButton}
          onPress={onChatWhatsapp}
          accessibilityRole="button"
          accessibilityLabel="Chat on WhatsApp"
        >
          <Ionicons name="logo-whatsapp" size={16} color={BRAND.primary} />
          <Text style={styles.secondaryButtonText}>Chat on WhatsApp</Text>
        </Pressable>
      </View>

      <View style={[styles.careCard, { backgroundColor: colors.muted }]}>
        <View
          style={[
            styles.careIcon,
            { backgroundColor: colors.primaryLowOpacity },
          ]}
        >
          <Ionicons name="sparkles-outline" size={22} color={BRAND.primary} />
        </View>
        <View style={styles.careCopy}>
          <Text style={[styles.careTitle, { color: colors.text }]}>
            Free port & speaker cleaning
          </Text>
          <Text style={[styles.careText, { color: colors.textSecondary }]}>
            Sometimes a blocked port only needs a little care. Ask us to check
            it before replacing anything.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}
