import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import Feather from '@react-native-vector-icons/feather';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { palette } from '@/constants/Colors';
import { useTheme } from '@/hooks/useTheme';
import { getFilterBarStyles } from './FilterBar.styles';

type FilterType = 'price' | 'brand' | 'condition' | 'rating';
const MAX_PRICE_CEILING = 3_000_000;

export interface FilterBarActiveControlsProps {
  inSheet?: boolean;
  onDone?: () => void;
  activeFilterType: FilterType;
  minPrice: number;
  maxPrice: number;
  onPriceChange: (min: number, max: number) => void;
  brands: string[];
  selectedBrand: string;
  onSelectBrand: (brand: string) => void;
  selectedCondition: string;
  onSelectCondition: (condition: string) => void;
  minRating: number;
  onSelectRating: (rating: number) => void;
}

function normalizePriceInput(value: string, fallback: number) {
  if (value.trim() === '') {
    return fallback;
  }

  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue)) {
    return fallback;
  }

  return Math.min(MAX_PRICE_CEILING, Math.max(0, parsedValue));
}

function formatMinPriceInput(value: number) {
  return value > 0 ? value.toString() : '';
}

function formatMaxPriceInput(value: number) {
  return value < MAX_PRICE_CEILING ? value.toString() : '';
}

function getBrandOptions(brands: string[]) {
  const seenBrands = new Set(['All']);
  const dedupedBrands = brands.filter((brand) => {
    if (seenBrands.has(brand)) {
      return false;
    }

    seenBrands.add(brand);
    return true;
  });

  return ['All', ...dedupedBrands];
}

export function FilterBarActiveControls({
  inSheet = false,
  onDone,
  activeFilterType,
  minPrice,
  maxPrice,
  onPriceChange,
  brands,
  selectedBrand,
  onSelectBrand,
  selectedCondition,
  onSelectCondition,
  minRating,
  onSelectRating,
}: FilterBarActiveControlsProps) {
  const [tempMinPrice, setTempMinPrice] = useState(
    formatMinPriceInput(minPrice)
  );
  const [tempMaxPrice, setTempMaxPrice] = useState(
    formatMaxPriceInput(maxPrice)
  );
  const [prevMinPrice, setPrevMinPrice] = useState(minPrice);
  const [prevMaxPrice, setPrevMaxPrice] = useState(maxPrice);
  const { colors } = useTheme();
  const styles = getFilterBarStyles(colors);

  // Re-sync the draft inputs inline during render (prev-prop comparison)
  // instead of in an effect, so the inputs never show a stale frame.
  if (minPrice !== prevMinPrice || maxPrice !== prevMaxPrice) {
    setPrevMinPrice(minPrice);
    setPrevMaxPrice(maxPrice);
    setTempMinPrice(formatMinPriceInput(minPrice));
    setTempMaxPrice(formatMaxPriceInput(maxPrice));
  }

  const handlePriceBlur = () => {
    const nextMinPrice = normalizePriceInput(tempMinPrice, 0);
    const nextMaxPrice = normalizePriceInput(tempMaxPrice, MAX_PRICE_CEILING);

    setTempMinPrice(formatMinPriceInput(nextMinPrice));
    setTempMaxPrice(formatMaxPriceInput(nextMaxPrice));
    onPriceChange(nextMinPrice, nextMaxPrice);
  };
  const brandOptions = getBrandOptions(brands);
  const PriceInput = inSheet ? BottomSheetTextInput : TextInput;
  const BrandContainer = inSheet ? View : ScrollView;

  switch (activeFilterType) {
    case 'price':
      return (
        <View>
          <View style={styles.priceRow}>
            <View style={styles.priceField}>
              <Text style={styles.currency}>₦</Text>
              <PriceInput
                style={styles.priceInput}
                value={tempMinPrice}
                onChangeText={setTempMinPrice}
                role="spinbutton"
                accessibilityLabel="Min"
                placeholder="0"
                keyboardType="numeric"
                onBlur={handlePriceBlur}
                placeholderTextColor={colors.placeholder}
              />
            </View>
            <Text style={styles.dash}>-</Text>
            <View style={styles.priceField}>
              <Text style={styles.currency}>₦</Text>
              <PriceInput
                style={styles.priceInput}
                value={tempMaxPrice}
                onChangeText={setTempMaxPrice}
                role="spinbutton"
                accessibilityLabel="Max"
                placeholder="Max"
                keyboardType="numeric"
                onBlur={handlePriceBlur}
                placeholderTextColor={colors.placeholder}
              />
            </View>
          </View>
          {inSheet && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Done"
              onPress={() => {
                handlePriceBlur();
                onDone?.();
              }}
              style={{
                marginTop: 24,
                minHeight: 48,
                borderRadius: 14,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.primary,
              }}
            >
              <Text
                style={{
                  color: colors.primaryForeground,
                  fontSize: 15,
                  fontWeight: '600',
                }}
              >
                Done
              </Text>
            </Pressable>
          )}
        </View>
      );
    case 'brand':
      return (
        <BrandContainer
          horizontal={!inSheet}
          showsHorizontalScrollIndicator={false}
          style={
            inSheet
              ? { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }
              : styles.brandScroll
          }
          contentContainerStyle={
            inSheet ? undefined : styles.brandScrollContent
          }
        >
          {brandOptions.map((brand) => {
            const isActive = selectedBrand === brand;
            return (
              <Pressable
                key={brand}
                accessibilityRole="button"
                accessibilityLabel={brand}
                accessibilityState={{ selected: isActive }}
                onPress={() => onSelectBrand(brand)}
                style={[
                  styles.brandChip,
                  isActive ? styles.brandChipActive : styles.brandChipInactive,
                ]}
                hitSlop={6}
              >
                <Feather
                  name="grid"
                  size={13}
                  color={
                    isActive ? colors.primaryForeground : colors.textSecondary
                  }
                  style={styles.brandChipIcon}
                />
                <Text
                  style={[
                    styles.brandChipText,
                    isActive
                      ? styles.brandChipTextActive
                      : styles.brandChipTextInactive,
                  ]}
                >
                  {brand}
                </Text>
              </Pressable>
            );
          })}
        </BrandContainer>
      );
    case 'condition':
      return (
        <View style={styles.conditionSegment}>
          {['All', 'New', 'Open Box', 'Used'].map((condition) => (
            <Pressable
              key={condition}
              accessibilityRole="button"
              accessibilityLabel={condition}
              accessibilityState={{
                selected: selectedCondition === condition,
              }}
              onPress={() => onSelectCondition(condition)}
              style={[
                styles.segmentItem,
                selectedCondition === condition && styles.segmentItemActive,
              ]}
              hitSlop={6}
            >
              <Text
                style={[
                  styles.segmentText,
                  selectedCondition === condition && styles.segmentTextActive,
                ]}
              >
                {condition}
              </Text>
            </Pressable>
          ))}
        </View>
      );
    case 'rating':
      return (
        <View style={styles.ratingRow}>
          {[4, 3, 2, 1].map((rating) => (
            <Pressable
              key={rating}
              accessibilityRole="button"
              accessibilityLabel={`${rating}+`}
              accessibilityState={{ selected: minRating === rating }}
              onPress={() => onSelectRating(minRating === rating ? 0 : rating)}
              style={[
                styles.ratingChip,
                minRating === rating && styles.ratingChipActive,
              ]}
              hitSlop={6}
            >
              <Text
                style={[
                  styles.ratingText,
                  minRating === rating && styles.ratingTextActive,
                ]}
              >
                {rating}+
              </Text>
              <Ionicons
                name="star"
                size={10}
                color={
                  minRating === rating ? palette.amber[700] : palette.amber[500]
                }
              />
            </Pressable>
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Any"
            accessibilityState={{ selected: minRating === 0 }}
            onPress={() => onSelectRating(0)}
            hitSlop={8}
          >
            <Text
              style={[styles.anyText, minRating === 0 && styles.anyTextActive]}
            >
              Any
            </Text>
          </Pressable>
        </View>
      );
  }
}
