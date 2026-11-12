import { Pressable, Text, TextInput, View } from 'react-native';
import { BRAND, palette } from '@/constants/Colors';
import { SavingsSelectedPhoneCard } from './SavingsSelectedPhoneCard';
import { StartSavingsProductSuggestions } from './StartSavingsProductSuggestions';
import { StartSavingsVariantOptions } from './StartSavingsVariantOptions';
import { savingsProductImage } from './savings-product-image';
import { themedInputStyle } from './start-savings.helpers';
import { startSavingsStyles as styles } from './start-savings.styles';
import type { StartSavingsColors } from './start-savings.types';
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
      {!controller.selectedProduct ? (
        <TextInput
          accessibilityRole="search"
          accessibilityLabel="Savings product search"
          onFocus={() => onSearchFocusChange?.(true)}
          onBlur={() => onSearchFocusChange?.(false)}
          value={controller.searchValue}
          onChangeText={controller.setSearchValue}
          placeholder="Search for a phone, laptop or gadget"
          placeholderTextColor={colors.placeholder}
          style={[styles.input, themedInputStyle(colors)]}
        />
      ) : null}
      {controller.selectedProduct ? (
        <>
          <SavingsSelectedPhoneCard
            colors={colors}
            product={controller.selectedProduct}
            imageUri={savingsProductImage(
              controller.selectedCatalogProduct,
              variantPicker?.groups ?? [],
              controller.selectedProduct.image
            )}
            loadingOptions={Boolean(
              controller.selectedCatalogProduct?.searchPreview
            )}
            onChange={() => controller.setSearchValue('')}
          />
          {variantPicker ? (
            <VariantOptions
              colors={colors}
              groups={variantPicker.groups}
              onSelect={variantPicker.onSelect}
            />
          ) : null}
        </>
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
