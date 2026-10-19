import { Pressable, Text, View } from 'react-native';
import { BRAND, palette } from '@/constants/Colors';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { startSavingsStyles as styles } from './start-savings.styles';
import type { StartSavingsColors } from './start-savings.types';
import type { StartSavingsProductController } from './start-savings-controller.types';
import { getSavingsVariantOptions } from './start-savings-controller.utils';

type StartSavingsVariantOptionsProps = {
  colors: StartSavingsColors;
  controller: StartSavingsProductController;
};

export function StartSavingsVariantOptions({
  colors,
  controller,
}: StartSavingsVariantOptionsProps) {
  const product = controller.selectedCatalogProduct;
  if (!product) {
    return null;
  }

  const options = getSavingsVariantOptions(product);
  if (options.length === 0) {
    return null;
  }

  return (
    <View style={styles.section}>
      <Text style={[styles.sectionLabel, { color: colors.text }]}>
        Choose exact variant
      </Text>
      <View style={styles.section}>
        {options.map((option) => {
          const isActive = controller.selectedProduct?.variantId === option.id;
          const label = option.unavailable
            ? 'Unavailable'
            : formatNgnCurrency(option.price);
          return (
            <Pressable
              key={option.id}
              accessibilityRole="button"
              accessibilityLabel={`Select ${product.name} ${option.label}`}
              accessibilityState={{
                disabled: option.unavailable,
                selected: isActive,
              }}
              disabled={option.unavailable}
              onPress={() => controller.selectProduct(product, option.id)}
              style={[
                styles.selectedProductCard,
                {
                  width: '100%',
                  backgroundColor: isActive ? BRAND.primary : colors.card,
                  borderColor: isActive ? BRAND.primary : colors.border,
                },
                option.unavailable ? styles.buttonDisabled : null,
              ]}
            >
              <Text
                style={[
                  styles.selectedProductName,
                  { color: isActive ? palette.white : colors.text },
                ]}
              >
                {option.label.split(' · ').join('\n')}
              </Text>
              <Text
                style={[
                  styles.selectedProductPrice,
                  { color: isActive ? palette.white : colors.primary },
                ]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
