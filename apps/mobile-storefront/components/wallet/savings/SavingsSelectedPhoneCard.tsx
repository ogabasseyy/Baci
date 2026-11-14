import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BRAND, palette } from '@/constants/Colors';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { SavingsProductThumb } from './SavingsProductThumb';
import type {
  SavingsProductChoice,
  StartSavingsColors,
} from './start-savings.types';

/**
 * The phone being saved for, laid out like the Add to savings sheet's card:
 * thumbnail on the left; name, condition tag and price; a red Change pill.
 */
export function SavingsSelectedPhoneCard({
  colors,
  product,
  imageUri,
  loadingOptions,
  onChange,
}: {
  colors: StartSavingsColors;
  product: SavingsProductChoice;
  imageUri: string;
  loadingOptions: boolean;
  onChange: () => void;
}) {
  const priced = !product.requiresVariantSelection && product.price > 0;
  return (
    <View style={[styles.card, { borderColor: colors.border }]}>
      <SavingsProductThumb uri={imageUri} title={product.name} />
      <View style={styles.copy}>
        <Text style={[styles.name, { color: colors.text }]} numberOfLines={2}>
          {product.name}
        </Text>
        <View style={styles.metaRow}>
          {product.conditionLabel ? (
            <Text style={[styles.tag, { color: colors.text }]}>
              {product.conditionLabel}
            </Text>
          ) : null}
          <Text
            style={[
              styles.price,
              { color: priced ? colors.text : colors.textSecondary },
            ]}
          >
            {priced
              ? formatNgnCurrency(product.price)
              : loadingOptions
                ? 'Loading options…'
                : 'Choose your options'}
          </Text>
        </View>
        {product.variantLabel ? (
          <Text
            style={[styles.detail, { color: colors.textSecondary }]}
            numberOfLines={1}
          >
            {product.variantLabel}
          </Text>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Change savings device"
        hitSlop={8}
        onPress={onChange}
        style={styles.change}
      >
        <Ionicons
          name="swap-horizontal-outline"
          size={14}
          color={BRAND.primary}
        />
        <Text style={styles.changeText}>Change</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: palette.red[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: 48, height: 48 },
  copy: { flex: 1, minWidth: 0, gap: 4 },
  name: { fontSize: 15, fontWeight: '700', lineHeight: 20 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tag: {
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: palette.red[100],
    paddingHorizontal: 8,
    paddingVertical: 2,
    fontSize: 11,
    fontWeight: '600',
  },
  price: { fontSize: 13, fontWeight: '600' },
  detail: { fontSize: 12 },
  change: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    backgroundColor: palette.red[50],
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  changeText: { color: BRAND.primary, fontSize: 12, fontWeight: '600' },
});
