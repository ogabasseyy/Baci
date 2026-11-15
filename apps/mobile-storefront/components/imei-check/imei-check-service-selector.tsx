import {
  groupImeiServices,
  IMEI_SERVICE_TIERS,
  type ImeiServiceTierKey,
} from '@baci/shared/imei';
import Ionicons, {
  type IoniconsIconName,
} from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BRAND, withAlpha } from '@/constants/Colors';
import { ImeiTicketNotch, imeiCareIcon } from './imei-care-look';
import type { ImeiCheckerColors } from './imei-check.types';
import { pickerStyles as styles } from './imei-check-picker.styles';
import { ImeiCheckTierRow } from './imei-check-tier-row';
import { ImeiServiceDetailsSheet } from './imei-service-details-sheet';

const GROUP_ICONS: Record<string, IoniconsIconName> = {
  details: 'phone-portrait-outline',
  blacklist: 'shield-outline',
  network: 'cellular-outline',
  ownership: 'lock-closed-outline',
  history: 'time-outline',
  finance: 'card-outline',
  advanced: 'construct-outline',
  reports: 'document-text-outline',
};

interface ImeiCheckServiceSelectorProps {
  colors: ImeiCheckerColors;
  displayedTierKeys: readonly ImeiServiceTierKey[];
  selectedTier: ImeiServiceTierKey | null;
  canToggleServices: boolean;
  showAllServices: boolean;
  onTierSelect: (tier: ImeiServiceTierKey) => void;
  onToggleServices: () => void;
}

/**
 * The check picker. Each goal ("Lost or stolen check") is one card; with the
 * popular checks shown, a card leads with one check and a red "N more" row
 * names what else it holds. With every check shown, each card lists all of
 * its checks, so no per-card toggle repeats down the page.
 */
export function ImeiCheckServiceSelector({
  colors,
  displayedTierKeys,
  selectedTier,
  canToggleServices,
  showAllServices,
  onTierSelect,
  onToggleServices,
}: ImeiCheckServiceSelectorProps) {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [detailsTier, setDetailsTier] = useState<ImeiServiceTierKey | null>(
    null
  );
  const careIcon = imeiCareIcon(colors);
  const groups = groupImeiServices(
    displayedTierKeys,
    selectedTier ?? displayedTierKeys[0] ?? 'full'
  );

  return (
    <>
      <View style={styles.groups}>
        {groups.map((group) => {
          const open = showAllServices || openGroups[group.id] === true;
          // Open cards keep catalogue order, so picking a different option
          // never reshuffles the rows under the customer's finger.
          const rows = open
            ? displayedTierKeys.filter((key) => group.tierKeys.includes(key))
            : group.tierKeys.slice(0, 1);
          const hidden = group.tierKeys.filter((key) => !rows.includes(key));
          const canFold = !showAllServices && group.tierKeys.length > 1;
          return (
            <View key={group.id} style={styles.group}>
              <View style={styles.groupHeader}>
                <View
                  style={[
                    styles.groupIcon,
                    { backgroundColor: careIcon.background },
                  ]}
                >
                  <Ionicons
                    name={GROUP_ICONS[group.id] ?? 'checkmark-done-outline'}
                    size={16}
                    color={careIcon.color}
                  />
                </View>
                <Text
                  accessibilityRole="header"
                  style={[styles.groupTitle, { color: colors.text }]}
                >
                  {group.label}
                </Text>
                {group.tierKeys.length > 1 ? (
                  <Text
                    style={[styles.groupMeta, { color: colors.textSecondary }]}
                  >
                    {`${group.tierKeys.length} options`}
                  </Text>
                ) : null}
              </View>
              <View
                style={[
                  styles.card,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <ImeiTicketNotch colors={colors} />
                {rows.map((tierKey, index) => (
                  <ImeiCheckTierRow
                    key={tierKey}
                    colors={colors}
                    divider={index > 0}
                    isSelected={selectedTier === tierKey}
                    tier={IMEI_SERVICE_TIERS[tierKey]}
                    onPress={() => onTierSelect(tierKey)}
                    onShowDetails={() => setDetailsTier(tierKey)}
                  />
                ))}
                {canFold ? (
                  <GroupFoldRow
                    colors={colors}
                    groupLabel={group.label}
                    hiddenNames={hidden.map(
                      (key) => IMEI_SERVICE_TIERS[key].name
                    )}
                    open={open}
                    onPress={() =>
                      setOpenGroups((current) => ({
                        ...current,
                        [group.id]: !current[group.id],
                      }))
                    }
                  />
                ) : null}
              </View>
            </View>
          );
        })}
      </View>

      {canToggleServices ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: showAllServices }}
          style={[
            styles.allChecks,
            {
              backgroundColor: showAllServices
                ? colors.card
                : withAlpha(BRAND.primary, 0.06),
              borderColor: withAlpha(BRAND.primary, 0.35),
            },
          ]}
          onPress={onToggleServices}
        >
          <Ionicons
            name={showAllServices ? 'contract-outline' : 'apps-outline'}
            size={20}
            color={BRAND.primary}
          />
          <View style={styles.allChecksBody}>
            <Text style={[styles.allChecksTitle, { color: BRAND.primary }]}>
              {showAllServices ? 'Show popular checks only' : 'See all checks'}
            </Text>
            <Text
              style={[styles.allChecksHint, { color: colors.textSecondary }]}
            >
              {showAllServices
                ? 'Hide the specialist checks'
                : 'Warranty, finance locks, MDM and more'}
            </Text>
          </View>
          <Ionicons
            name={showAllServices ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={BRAND.primary}
          />
        </Pressable>
      ) : null}

      <ImeiServiceDetailsSheet
        colors={colors}
        tier={detailsTier ? IMEI_SERVICE_TIERS[detailsTier] : null}
        onClose={() => setDetailsTier(null)}
        onChoose={() => {
          if (detailsTier) onTierSelect(detailsTier);
          setDetailsTier(null);
        }}
      />
    </>
  );
}

function GroupFoldRow({
  colors,
  groupLabel,
  hiddenNames,
  open,
  onPress,
}: {
  colors: ImeiCheckerColors;
  groupLabel: string;
  hiddenNames: string[];
  open: boolean;
  onPress: () => void;
}) {
  const count = hiddenNames.length;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        open ? `Fewer ${groupLabel} options` : `More ${groupLabel} options`
      }
      accessibilityState={{ expanded: open }}
      onPress={onPress}
      style={[styles.moreRow, { borderTopColor: colors.border }]}
    >
      <Ionicons
        name={open ? 'remove-circle-outline' : 'add-circle-outline'}
        size={20}
        color={BRAND.primary}
      />
      <View style={styles.moreBody}>
        <Text style={[styles.moreTitle, { color: BRAND.primary }]}>
          {open
            ? 'Show fewer options'
            : `${count} more ${count === 1 ? 'option' : 'options'}`}
        </Text>
        {open ? null : (
          <Text
            numberOfLines={1}
            style={[styles.moreNames, { color: colors.textSecondary }]}
          >
            {hiddenNames.join(' · ')}
          </Text>
        )}
      </View>
      <Ionicons
        name={open ? 'chevron-up' : 'chevron-down'}
        size={16}
        color={BRAND.primary}
      />
    </Pressable>
  );
}
