import { StyleSheet, Text, View } from 'react-native';
import type { ThemeColors } from '@/constants/theme';
import { TYPOGRAPHY } from '@/constants/theme';
import { styles as sheetStyles } from './ShipmentFlowSheet.styles';
import type { ShipmentOptionDetail } from './ShipmentOptionCard';

interface Props {
  colors: ThemeColors;
  description: string;
  details: ShipmentOptionDetail[];
  price?: string;
}

/**
 * Read-only GIG card for staff who may see the price and the wallet balance
 * but cannot book: same facts as the option card, nothing to select, plus
 * who can book it.
 */
export function ShipmentGiglPreviewCard({
  colors,
  description,
  details,
  price,
}: Props) {
  return (
    <View>
      <View
        style={[
          sheetStyles.optionCard,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <View style={sheetStyles.optionCopy}>
          <Text style={[sheetStyles.optionTitle, { color: colors.text }]}>
            GIG delivery
          </Text>
          <Text
            style={[
              sheetStyles.optionDescription,
              { color: colors.textSecondary },
            ]}
          >
            {description}
          </Text>
          {details.map((detail) => (
            <Text
              key={detail.text}
              style={[
                previewStyles.detail,
                {
                  color:
                    detail.tone === 'warning'
                      ? colors.warning
                      : colors.textSecondary,
                },
              ]}
            >
              {detail.text}
            </Text>
          ))}
        </View>
        {price ? (
          <Text style={[previewStyles.price, { color: colors.text }]}>
            {price}
          </Text>
        ) : null}
      </View>
      <Text style={[previewStyles.note, { color: colors.textSecondary }]}>
        Ask the store owner or an admin to book GIG for this order.
      </Text>
    </View>
  );
}

const previewStyles = StyleSheet.create({
  detail: { fontSize: TYPOGRAPHY.size.sm },
  note: { marginBottom: 12, paddingHorizontal: 12 },
  price: { fontSize: 16, fontWeight: '700' },
});
