import { Pressable, Text, View } from 'react-native';
import type { ThemeColors } from '@/constants/theme';
import type { InventoryConditionOffer } from '@/hooks/useInventoryConditionOffers';
import {
  badgeTextStyle,
  selectedBadgeStyle,
} from './VariantInventoryUnitCard.helpers';
import { variantInventoryUnitsSheetStyles as styles } from './VariantInventoryUnitsSheet.styles';

interface InventoryOfferAssignmentProps {
  colors: ThemeColors;
  offers: InventoryConditionOffer[];
  offerId: string | null;
  disabled: boolean;
  onAssign: (offerId: string | null) => void;
}

export function InventoryOfferAssignment({
  colors,
  offers,
  offerId,
  disabled,
  onAssign,
}: InventoryOfferAssignmentProps) {
  return (
    <View style={styles.formRow}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>
        Condition offer
      </Text>
      <View style={styles.badgeRow}>
        <Pressable
          accessibilityLabel="Clear condition assignment"
          accessibilityRole="radio"
          accessibilityState={{ checked: offerId === null, disabled }}
          disabled={disabled}
          onPress={() => onAssign(null)}
          style={[
            styles.badgeOption,
            { borderColor: colors.border },
            offerId === null && selectedBadgeStyle(colors),
          ]}
        >
          <Text style={badgeTextStyle(colors, offerId === null)}>
            Unassigned
          </Text>
        </Pressable>
        {offers.map((offer) => {
          const selected = offer.id === offerId;
          const label = offer.condition.replaceAll('_', ' ');
          const suffix =
            offer.status === 'active' ? '' : ` (${offer.status ?? 'inactive'})`;
          return (
            <Pressable
              key={offer.id}
              accessibilityLabel={`Assign ${label} condition${suffix}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected, disabled }}
              disabled={disabled}
              onPress={() => onAssign(offer.id)}
              style={[
                styles.badgeOption,
                { borderColor: colors.border },
                selected && selectedBadgeStyle(colors),
              ]}
            >
              <Text style={badgeTextStyle(colors, selected)}>
                {label}
                {suffix}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
