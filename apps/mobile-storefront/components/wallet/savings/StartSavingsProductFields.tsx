import { Pressable, Text, TextInput, View } from 'react-native';
import { SafeImage } from '@/components/ui/SafeImage';
import { BRAND, palette } from '@/constants/Colors';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { StartSavingsProductSuggestions } from './StartSavingsProductSuggestions';
import { StartSavingsVariantOptions } from './StartSavingsVariantOptions';
import { savingsCardAccent } from './savings-card-accent';
import { savingsProductImage } from './savings-product-image';
import { themedInputStyle } from './start-savings.helpers';
import { startSavingsStyles as styles } from './start-savings.styles';
import type {
  SavingsProductChoice,
  StartSavingsColors,
} from './start-savings.types';
import type {
  StartSavingsController,
  StartSavingsProductController,
} from './start-savings-controller.types';
import type { SavingsVariantOptionGroup } from './start-savings-variant-options';

type StartSavingsProductFieldsProps = {
  onSearchFocusChange?: (focused: boolean) => void;
  colors: StartSavingsColors;
  controller: StartSavingsController;
};

export function StartSavingsProductFields(
  props:
    | (StartSavingsProductFieldsProps & { mode?: 'plan' })
    | {
        mode: 'draft';
        onSearchFocusChange?: (focused: boolean) => void;
        colors: StartSavingsColors;
        controller: StartSavingsProductController;
      }
) {
  return (
    <View style={[styles.setupCard, savingsCardAccent(props.colors)]}>
      <ProductSearchSection
        onSearchFocusChange={props.onSearchFocusChange}
        colors={props.colors}
        controller={props.controller}
        variantPicker={
          props.mode !== 'draft'
            ? {
                groups: props.controller.variantOptionGroups,
                onSelect: props.controller.selectVariantOption,
              }
            : null
        }
      />
    </View>
  );
}

function ProductSearchSection({
  colors,
  controller,
  variantPicker,
  onSearchFocusChange,
}: {
  onSearchFocusChange?: (focused: boolean) => void;
  colors: StartSavingsColors;
  controller: StartSavingsProductController;
  variantPicker: {
    groups: SavingsVariantOptionGroup[];
    onSelect: (axis: string, value: string) => void;
  } | null;
}) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionLabel, { color: colors.text }]}>
        01 · Pick your next upgrade
      </Text>
      {!controller.selectedProduct ? (
        <TextInput
          accessibilityRole="search"
          accessibilityLabel="Savings product search"
          onFocus={() => onSearchFocusChange?.(true)}
          onBlur={() => onSearchFocusChange?.(false)}
          value={controller.searchValue}
          onChangeText={controller.setSearchValue}
          placeholder="Find your phone, laptop, wish-list fave…"
          placeholderTextColor={colors.placeholder}
          style={[styles.input, themedInputStyle(colors)]}
        />
      ) : null}
      {controller.selectedProduct ? (
        <View
          style={[
            styles.selectedProductCard,
            { borderColor: colors.border, backgroundColor: colors.card },
          ]}
        >
          <Text
            style={[
              styles.selectedProductLabel,
              { color: colors.textSecondary },
            ]}
          >
            THE ONE YOU’RE SAVING FOR
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                style={[styles.selectedProductName, { color: colors.text }]}
              >
                {controller.selectedProduct.name}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Change savings device"
                onPress={() => controller.setSearchValue('')}
                style={{ paddingVertical: 12, alignSelf: 'flex-start' }}
              >
                <Text
                  style={{
                    color: colors.primary,
                    fontSize: 12,
                    textDecorationLine: 'underline',
                  }}
                >
                  Change device
                </Text>
              </Pressable>
            </View>
            <View style={{ alignItems: 'center', gap: 8, maxWidth: '45%' }}>
              <SafeImage
                source={{
                  uri: savingsProductImage(
                    controller.selectedCatalogProduct,
                    variantPicker?.groups ?? [],
                    controller.selectedProduct.image
                  ),
                }}
                style={{ width: 76, height: 76, flexShrink: 0 }}
                contentFit="contain"
              />
              {!controller.selectedProduct.requiresVariantSelection &&
              controller.selectedProduct.price > 0 ? (
                <Text
                  style={[
                    styles.selectedProductPrice,
                    { color: colors.primary, textAlign: 'center' },
                  ]}
                >
                  {formatNgnCurrency(controller.selectedProduct.price)}
                </Text>
              ) : null}
            </View>
          </View>
          {controller.selectedProduct.requiresVariantSelection ? (
            <Text
              style={[styles.selectedProductPrice, { color: colors.primary }]}
            >
              {controller.selectedCatalogProduct?.searchPreview
                ? 'Loading current options…'
                : controller.selectedProduct.requiresVariantSelection
                  ? 'Make it yours — choose your options'
                  : formatNgnCurrency(controller.selectedProduct.price)}
            </Text>
          ) : null}
          {!controller.selectedProduct.requiresVariantSelection &&
          controller.selectedProduct.price > 0 ? (
            <Text
              accessibilityLiveRegion="polite"
              style={{ color: colors.textSecondary }}
            >
              ✓ Your goal is set
            </Text>
          ) : null}
          <ProductMeta colors={colors} product={controller.selectedProduct} />
          {variantPicker ? (
            <VariantOptions
              colors={colors}
              groups={variantPicker.groups}
              onSelect={variantPicker.onSelect}
            />
          ) : null}
        </View>
      ) : null}
      {controller.selectedProduct && !variantPicker?.groups.length ? (
        <StartSavingsVariantOptions colors={colors} controller={controller} />
      ) : null}
      {!controller.selectedProduct ? (
        <StartSavingsProductSuggestions
          colors={colors}
          controller={controller}
        />
      ) : null}
    </View>
  );
}

function VariantOptions({
  colors,
  groups,
  onSelect,
}: {
  onSearchFocusChange?: (focused: boolean) => void;
  colors: StartSavingsColors;
  groups: SavingsVariantOptionGroup[];
  onSelect: (axis: string, value: string) => void;
}) {
  if (groups.length === 0) {
    return null;
  }

  return (
    <View style={styles.variantGroups}>
      {groups.map((group) => (
        <View key={group.key} style={styles.variantGroup}>
          <Text
            style={[
              styles.selectedProductLabel,
              { color: colors.textSecondary },
            ]}
          >
            {group.label}
          </Text>
          <View
            style={styles.variantGrid}
            testID={`variant-options-${group.key}`}
          >
            {group.values.map((option) => (
              <View
                key={`${group.key}:${option.value}`}
                style={[
                  styles.variantOption,
                  {
                    backgroundColor: option.selected
                      ? BRAND.primary
                      : colors.card,
                    borderColor: option.selected
                      ? BRAND.primary
                      : colors.border,
                  },
                ]}
              >
                <Pressable
                  accessibilityLabel={`Select ${group.label} ${option.label}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: option.selected }}
                  onPress={() => onSelect(group.key, option.value)}
                  style={styles.variantOptionPressable}
                >
                  <Text
                    style={[
                      styles.variantOptionText,
                      {
                        color: option.selected ? palette.white : colors.text,
                      },
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function ProductMeta({
  colors,
  product,
}: {
  onSearchFocusChange?: (focused: boolean) => void;
  colors: StartSavingsColors;
  product: SavingsProductChoice;
}) {
  const meta = [product.conditionLabel, product.variantLabel].filter(
    (value): value is string => Boolean(value)
  );

  if (meta.length === 0) {
    return null;
  }

  return (
    <Text style={[styles.productMetaText, { color: colors.textSecondary }]}>
      {meta.join(' · ')}
    </Text>
  );
}
