import {
  groupImeiServices,
  IMEI_SERVICE_TIERS,
  type ImeiServiceTierDefinition,
  type ImeiServiceTierKey,
} from '@baci/shared/imei';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { BRAND, withAlpha } from '@/constants/Colors';
import { formatServicePrice } from './format-service-price';
import { styles } from './imei-check.styles';
import type { ImeiCheckerColors } from './imei-check.types';

interface ImeiCheckServiceSelectorProps {
  colors: ImeiCheckerColors;
  displayedTierKeys: readonly ImeiServiceTierKey[];
  selectedTier: ImeiServiceTierKey;
  canToggleServices: boolean;
  showAllServices: boolean;
  onTierSelect: (tier: ImeiServiceTierKey) => void;
  onToggleServices: () => void;
}

export function ImeiCheckServiceSelector({
  colors,
  displayedTierKeys,
  selectedTier,
  canToggleServices,
  showAllServices,
  onTierSelect,
  onToggleServices,
}: ImeiCheckServiceSelectorProps) {
  const [expandedGoals, setExpandedGoals] = useState<Record<string, boolean>>(
    {}
  );
  const groups = groupImeiServices(displayedTierKeys, selectedTier).map(
    (group) =>
      expandedGoals[group.id]
        ? {
            ...group,
            tierKeys: displayedTierKeys.filter((key) =>
              group.tierKeys.includes(key)
            ),
          }
        : group
  );
  return (
    <>
      <View style={styles.tierGrid}>
        {groups.map((group) => (
          <View key={group.id} style={styles.tierGrid}>
            <Text
              accessibilityRole="header"
              style={[styles.sectionTitle, { color: colors.text }]}
            >
              {group.label}
            </Text>
            {(expandedGoals[group.id]
              ? group.tierKeys
              : group.tierKeys.slice(0, 1)
            ).map((tierKey) => (
              <TierCard
                key={tierKey}
                colors={colors}
                isSelected={selectedTier === tierKey}
                tier={IMEI_SERVICE_TIERS[tierKey]}
                onPress={() => onTierSelect(tierKey)}
              />
            ))}
            {group.tierKeys.length > 1 && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Other options for ${group.label}`}
                accessibilityState={{ expanded: !!expandedGoals[group.id] }}
                onPress={() =>
                  setExpandedGoals((current) => ({
                    ...current,
                    [group.id]: !current[group.id],
                  }))
                }
              >
                <Text
                  style={[
                    styles.expandServicesText,
                    { color: colors.textSecondary },
                  ]}
                >
                  {expandedGoals[group.id]
                    ? 'Hide other options'
                    : 'Other options'}
                </Text>
              </Pressable>
            )}
          </View>
        ))}
      </View>

      {canToggleServices && (
        <Pressable
          style={[
            styles.expandServicesButton,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
          onPress={onToggleServices}
        >
          <Text style={[styles.expandServicesText, { color: colors.text }]}>
            {showAllServices ? 'Show key checks' : 'More checks'}
          </Text>
          <Ionicons
            name={showAllServices ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.textSecondary}
          />
        </Pressable>
      )}
    </>
  );
}

function TierCard({
  colors,
  isSelected,
  onPress,
  tier,
}: {
  colors: ImeiCheckerColors;
  isSelected: boolean;
  onPress: () => void;
  tier: ImeiServiceTierDefinition;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: isSelected }}
      accessibilityLabel={`${tier.name}, ${formatServicePrice(tier.price)}`}
      style={[
        styles.tierCard,
        {
          backgroundColor: isSelected
            ? withAlpha(BRAND.primary, 0.08)
            : colors.card,
          borderColor: isSelected ? BRAND.primary : colors.border,
        },
      ]}
      onPress={onPress}
    >
      <Ionicons
        name={tier.icon}
        size={22}
        color={isSelected ? BRAND.primary : colors.textSecondary}
        style={styles.tierIcon}
      />
      <View style={styles.tierBody}>
        <View style={styles.tierNameRow}>
          <Text
            style={[
              styles.tierName,
              { color: isSelected ? BRAND.primary : colors.text },
            ]}
            numberOfLines={1}
          >
            {tier.name}
          </Text>
          {tier.recommended && (
            <View style={styles.recommendedBadge}>
              <Ionicons name="star" size={9} color={BRAND.onPrimary} />
              <Text style={styles.recommendedText}>BEST</Text>
            </View>
          )}
        </View>
        <Text
          style={[styles.tierTagline, { color: colors.textSecondary }]}
          numberOfLines={1}
        >
          {tier.tagline}
        </Text>
      </View>
      <Text
        style={[
          styles.tierPrice,
          { color: isSelected ? BRAND.primary : colors.text },
        ]}
      >
        {formatServicePrice(tier.price)}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`What ${tier.name} includes`}
        hitSlop={8}
        onPress={() =>
          Alert.alert(
            tier.name,
            `${tier.detail}\n\nIncludes: ${tier.features.join(' · ')}`
          )
        }
        style={styles.tierInfoButton}
      >
        <Ionicons
          name="information-circle-outline"
          size={18}
          color={colors.textSecondary}
        />
      </Pressable>
    </Pressable>
  );
}
