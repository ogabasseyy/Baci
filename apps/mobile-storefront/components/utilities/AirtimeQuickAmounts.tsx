import { Pressable, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { BRAND } from '@/constants/Colors';
import { airtimeFormStyles as styles } from './airtime-form.styles';

interface AirtimeQuickAmountsProps {
  amounts: readonly number[];
  colors: typeof Colors.light;
  onSelect: (amount: number) => void;
  selectedAmount: number;
}

/** The airtime form's preset amount chips (₦100, ₦200, …). */
export function AirtimeQuickAmounts({
  amounts,
  colors,
  onSelect,
  selectedAmount,
}: AirtimeQuickAmountsProps) {
  return (
    <View style={styles.quickAmounts}>
      {amounts.map((amount) => {
        const isSelectedAmount = selectedAmount === amount;

        return (
          <Pressable
            key={amount}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelectedAmount }}
            style={[
              styles.quickChip,
              {
                backgroundColor: isSelectedAmount
                  ? BRAND.primary
                  : colors.background,
                borderColor: isSelectedAmount ? BRAND.primary : colors.border,
              },
            ]}
            onPress={() => onSelect(amount)}
          >
            <Text
              style={[
                styles.quickChipText,
                {
                  color: isSelectedAmount ? BRAND.onPrimary : colors.text,
                },
              ]}
            >
              ₦{amount.toLocaleString()}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
