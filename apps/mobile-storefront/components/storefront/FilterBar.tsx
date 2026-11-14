import Feather, {
  type FeatherIconName,
} from '@react-native-vector-icons/feather';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { palette, withAlpha } from '@/constants/Colors';
import { useTheme } from '@/hooks/useTheme';
import { getFilterBarStyles } from './FilterBar.styles';
import { FilterBarActiveControls } from './FilterBarActiveControls';

interface FilterBarProps {
  categories: string[];
  useBrandRed?: boolean;
  selectedCategory: string;
  onSelectCategory: (category: string) => void;
  minPrice: number;
  maxPrice: number;
  onPriceChange: (min: number, max: number) => void;
  brands: string[];
  onBrandFilterVisible: () => void;
  selectedBrand: string;
  onSelectBrand: (brand: string) => void;
  selectedCondition: string;
  onSelectCondition: (condition: string) => void;
  minRating: number;
  onSelectRating: (rating: number) => void;
  viewMode: 'grid' | 'list';
  onViewModeChange: (mode: 'grid' | 'list') => void;
}

type FilterType = 'price' | 'brand' | 'condition' | 'rating';

const CATEGORY_ICONS: Record<string, FeatherIconName> = {
  All: 'grid',
  Phones: 'smartphone',
  Smartphones: 'smartphone',
  Gaming: 'target',
  Laptops: 'monitor',
  Accessories: 'headphones',
  Printers: 'printer',
  TVs: 'tv',
};

export function FilterBar({
  categories,
  useBrandRed = false,
  selectedCategory,
  onSelectCategory,
  minPrice,
  maxPrice,
  onPriceChange,
  brands,
  onBrandFilterVisible,
  selectedBrand,
  onSelectBrand,
  selectedCondition,
  onSelectCondition,
  minRating,
  onSelectRating,
  viewMode,
  onViewModeChange,
}: FilterBarProps) {
  const [activeFilterType, setActiveFilterType] = useState<FilterType>('price');
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);
  const { colors: themeColors, isDark } = useTheme();
  const colors = useBrandRed
    ? {
        ...themeColors,
        primary: palette.red[600],
        primaryForeground: palette.white,
        primaryLowOpacity: withAlpha(palette.red[600], isDark ? 0.18 : 0.08),
      }
    : themeColors;
  const accent = useBrandRed && isDark ? palette.red[400] : colors.primary;
  const styles = getFilterBarStyles(colors, accent);

  const getActiveFilterLabel = () => {
    switch (activeFilterType) {
      case 'price':
        return 'Price Range';
      case 'brand':
        return 'Brand';
      case 'condition':
        return 'Condition';
      case 'rating':
        return 'Rating';
      default:
        return 'Filter';
    }
  };

  return (
    <View style={styles.container}>
      {/* Backdrop for dismissal */}
      {isFilterMenuOpen && (
        <Pressable
          style={styles.backdrop}
          onPress={() => setIsFilterMenuOpen(false)}
        />
      )}
      {/* Category Row */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.categoryContent}
        style={styles.categoryList}
      >
        {categories.map((cat) => {
          const isActive = selectedCategory === cat;
          const icon = CATEGORY_ICONS[cat] || 'grid';
          return (
            <Pressable
              key={cat}
              onPress={() => onSelectCategory(cat)}
              style={[styles.catPill, isActive && styles.catPillActive]}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`${cat} category`}
              accessibilityState={{ selected: isActive }}
            >
              <Feather
                name={icon}
                size={15}
                color={isActive ? colors.primaryForeground : colors.icon}
              />
              <Text
                style={[styles.catText, isActive && styles.catTextActive]}
                numberOfLines={1}
              >
                {cat}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Tools Section */}
      <View style={styles.toolsContainer}>
        <View style={styles.mainTools}>
          {/* Filter Toggle */}
          <View style={styles.filterWrapper}>
            <Pressable
              onPress={() => setIsFilterMenuOpen(!isFilterMenuOpen)}
              style={styles.filterToggle}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Toggle filter menu"
              accessibilityState={{ expanded: isFilterMenuOpen }}
            >
              <Feather name="sliders" size={16} color={accent} />
              <Text style={styles.filterLabel}>{getActiveFilterLabel()}</Text>
              <Feather
                name="chevron-down"
                size={12}
                color={accent}
                style={[
                  styles.chevron,
                  {
                    transform: [
                      { rotate: isFilterMenuOpen ? '180deg' : '0deg' },
                    ],
                  },
                ]}
              />
            </Pressable>

            {/* Filter Menu Popover */}
            {isFilterMenuOpen && (
              <View style={styles.popover}>
                {[
                  { id: 'price', label: 'Price Range', icon: 'tag' },
                  { id: 'brand', label: 'Brand', icon: 'layers' },
                  { id: 'condition', label: 'Condition', icon: 'check-circle' },
                  { id: 'rating', label: 'Rating', icon: 'star' },
                ].map((item) => (
                  <Pressable
                    key={item.id}
                    onPress={() => {
                      if (item.id === 'brand') {
                        onBrandFilterVisible();
                      }
                      setActiveFilterType(item.id as FilterType);
                      setIsFilterMenuOpen(false);
                    }}
                    style={[
                      styles.popoverItem,
                      activeFilterType === item.id && styles.popoverItemActive,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={item.label}
                    accessibilityState={{
                      selected: activeFilterType === item.id,
                    }}
                  >
                    <Feather
                      name={item.icon as FeatherIconName}
                      size={16}
                      color={
                        activeFilterType === item.id
                          ? accent
                          : colors.textSecondary
                      }
                    />
                    <Text
                      style={[
                        styles.popoverText,
                        activeFilterType === item.id &&
                          styles.popoverTextActive,
                      ]}
                    >
                      {item.label}
                    </Text>
                    {activeFilterType === item.id && (
                      <Feather
                        name="check"
                        size={14}
                        color={accent}
                        style={styles.checkIcon}
                      />
                    )}
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          <View style={styles.vDivider} />

          {/* Dynamic Controls Area */}
          <View style={styles.dynamicArea}>
            <FilterBarActiveControls
              colorsOverride={colors}
              activeFilterType={activeFilterType}
              minPrice={minPrice}
              maxPrice={maxPrice}
              onPriceChange={onPriceChange}
              brands={brands}
              selectedBrand={selectedBrand}
              onSelectBrand={onSelectBrand}
              selectedCondition={selectedCondition}
              onSelectCondition={onSelectCondition}
              minRating={minRating}
              onSelectRating={onSelectRating}
            />
          </View>

          {/* View Toggle */}
          <View style={styles.viewToggle}>
            <Pressable
              onPress={() => onViewModeChange('grid')}
              style={[
                styles.viewBtn,
                viewMode === 'grid' && styles.viewBtnActive,
              ]}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Grid view"
              accessibilityState={{ selected: viewMode === 'grid' }}
            >
              <Feather
                name="grid"
                size={15}
                color={viewMode === 'grid' ? accent : colors.mutedForeground}
              />
            </Pressable>
            <Pressable
              onPress={() => onViewModeChange('list')}
              style={[
                styles.viewBtn,
                viewMode === 'list' && styles.viewBtnActive,
              ]}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="List view"
              accessibilityState={{ selected: viewMode === 'list' }}
            >
              <Feather
                name="list"
                size={15}
                color={viewMode === 'list' ? accent : colors.mutedForeground}
              />
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}
