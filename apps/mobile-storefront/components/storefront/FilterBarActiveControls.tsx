import Feather from '@react-native-vector-icons/feather';
import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { palette } from '@/constants/Colors';
import { useTheme } from '@/hooks/useTheme';
import { getFilterBarStyles } from './FilterBar.styles';
import { FilterPriceControls } from './FilterPriceControls';

type FilterType = 'price' | 'brand' | 'condition' | 'rating';

export interface FilterBarActiveControlsProps {
  inSheet?: boolean;
  onDone?: () => void;
  onPriceDraftChange?: (min: number, max: number) => void;
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
  onPriceDraftChange,
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
  const { colors } = useTheme();
  const styles = getFilterBarStyles(colors);
  const brandOptions = getBrandOptions(brands);
  const BrandContainer = inSheet ? View : ScrollView;

  switch (activeFilterType) {
    case 'price':
      return (
        <FilterPriceControls
          minPrice={minPrice}
          maxPrice={maxPrice}
          onPriceChange={onPriceChange}
          inSheet={inSheet}
          onDone={onDone}
          onPriceDraftChange={onPriceDraftChange}
        />
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
