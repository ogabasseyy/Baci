import Ionicons from '@react-native-vector-icons/ionicons';
import Constants from 'expo-constants';
import { type Href, router } from 'expo-router';
import { useEffect, useRef } from 'react';
import type { TextInputInstance } from 'react-native';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HeaderMinimal } from '@/components/storefront/HeaderMinimal';
import { getEliteHeaderTopPadding } from '@/components/storefront/header-layout';
import { Logo } from '@/components/ui/Logo';
import { SPACING } from '@/constants/Colors';
import { useTheme } from '@/hooks/useTheme';
import { CONFIG } from '@/lib/config';
import { SEASONAL } from '@/lib/seasonal';
import { getTemplateConfig } from '@/lib/templates';
import { useCartStore } from '@/stores/cart-store';
import { useDrawerStore } from '@/stores/drawer-store';
import { useThemeStore } from '@/stores/theme-store';
import { getHeaderStyles } from './header.styles';

interface HeaderProps {
  showSearch?: boolean;
  onSearchPress?: () => void;
  isSearchActive?: boolean;
  searchQuery?: string;
  onSearchQueryChange?: (text: string) => void;
  onSearchSubmit?: () => void;
  onSearchCancel?: () => void;
  isScrolled?: boolean;
}

// Background pattern from web (SVG Data URI)

export function Header({
  showSearch = true,
  onSearchPress,
  isSearchActive = false,
  searchQuery = '',
  onSearchQueryChange,
  onSearchSubmit,
  onSearchCancel,
  isScrolled = false,
}: HeaderProps) {
  const insets = useSafeAreaInsets();
  const searchInputRef = useRef<TextInputInstance>(null);
  const itemCount = useCartStore((state) => state.itemCount());
  const openDrawer = useDrawerStore((state) => state.openDrawer);
  const template = getTemplateConfig(CONFIG.BUSINESS_TYPE, CONFIG.TEMPLATE_ID);
  const theme = useThemeStore((state) => state.theme);
  const { colors } = useTheme();

  const styles = getHeaderStyles(colors);

  // Focus the search input when search mode activates (ref-based to avoid autoFocus a11y warning)
  useEffect(() => {
    if (isSearchActive) {
      const timer = setTimeout(() => searchInputRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
  }, [isSearchActive]);

  const handleSearchPress = () => {
    if (onSearchPress) {
      onSearchPress();
    } else {
      router.push('/search');
    }
  };

  const storeName = Constants.expoConfig?.name || 'Baci Store';
  const isSanta = SEASONAL.shouldShowSanta(theme);
  const seasonalTokens = SEASONAL.getTokens(theme);

  if (template.headerStyle === 'elite' || isSanta) {
    const eliteTopPadding = getEliteHeaderTopPadding(insets.top);

    return (
      <View
        testID="storefront-header"
        style={[
          styles.eliteContainer,
          isScrolled && { backgroundColor: colors.black },
          { paddingTop: eliteTopPadding },
          isSanta && { backgroundColor: seasonalTokens.holidayBg },
        ]}
      >
        {isSanta && (
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: 'rgba(255,0,0,0.1)' },
            ]}
          />
        )}

        <View style={styles.eliteContent}>
          <View style={styles.topRow}>
            <View style={styles.leftGroup}>
              <Pressable
                onPress={openDrawer}
                hitSlop={12}
                style={styles.menuBtn}
                accessibilityLabel="Open navigation menu"
                accessibilityRole="button"
              >
                <Ionicons name="menu-outline" size={28} color={colors.white} />
              </Pressable>

              <Pressable
                onPress={() => router.push('/')}
                style={styles.logoContainer}
                accessibilityLabel={`${storeName}, go to home`}
                accessibilityRole="button"
              >
                <Logo width={140} height={25} color={colors.white} />
              </Pressable>
            </View>

            <View style={styles.actionRow}>
              <Pressable
                onPress={() => router.navigate('/cart')}
                hitSlop={12}
                style={[styles.iconBtn, styles.rightIconBtn]}
                accessibilityLabel={
                  itemCount > 0
                    ? `Shopping cart, ${itemCount} ${itemCount === 1 ? 'item' : 'items'}`
                    : 'Shopping cart, empty'
                }
                accessibilityRole="button"
              >
                <Ionicons name="cart-outline" size={26} color={colors.white} />
                {itemCount > 0 && (
                  <View style={styles.badge} accessibilityElementsHidden={true}>
                    <Text style={styles.badgeText}>{itemCount}</Text>
                  </View>
                )}
              </Pressable>
            </View>
          </View>

          {showSearch && (
            <View
              style={[
                styles.searchRow,
                isSearchActive && styles.searchRowActive,
              ]}
            >
              <View
                style={[
                  styles.searchPill,
                  isSanta && styles.santaSearchPill,
                  isSearchActive && styles.activeSearchPill,
                ]}
              >
                <Ionicons
                  name="search-outline"
                  size={20}
                  color={
                    isSearchActive ? colors.textSecondary : colors.placeholder
                  }
                />
                {!isSearchActive ? (
                  <Pressable
                    onPress={handleSearchPress}
                    style={styles.searchPillPressable}
                    hitSlop={12}
                    accessibilityLabel="Search products, brands and categories"
                    accessibilityRole="search"
                  >
                    <Text
                      style={[
                        styles.searchPlaceholder,
                        isSanta && styles.santaPlaceholder,
                      ]}
                      numberOfLines={1}
                    >
                      Search products, brands and categories
                    </Text>
                  </Pressable>
                ) : (
                  <TextInput
                    ref={searchInputRef}
                    style={[styles.searchInput, { color: colors.text }]}
                    value={searchQuery}
                    onChangeText={onSearchQueryChange}
                    onSubmitEditing={onSearchSubmit}
                    placeholder="Search products…"
                    placeholderTextColor={colors.placeholder}
                    returnKeyType="search"
                    selectTextOnFocus={true}
                    clearButtonMode="while-editing"
                  />
                )}
              </View>

              {isSearchActive && (
                <Pressable
                  onPress={onSearchCancel}
                  hitSlop={10}
                  accessibilityLabel="Cancel search"
                  accessibilityRole="button"
                >
                  <Text style={styles.cancelText}>Cancel</Text>
                </Pressable>
              )}
            </View>
          )}
        </View>
      </View>
    );
  }

  if (template.headerStyle === 'minimal') {
    return (
      <HeaderMinimal
        colors={colors}
        handleSearchPress={handleSearchPress}
        insetsTop={insets.top}
        isScrolled={isScrolled}
        itemCount={itemCount}
        showSearch={showSearch}
        storeName={storeName}
        styles={styles}
      />
    );
  }

  return (
    <View
      style={[styles.defaultContainer, { paddingTop: insets.top + SPACING.sm }]}
    >
      <View style={styles.defaultTopRow}>
        <Text style={styles.defaultLogoText}>{storeName.split(' - ')[0]}</Text>
        <View style={styles.actionRow}>
          <Pressable
            onPress={() => router.push('/notifications' as Href)}
            hitSlop={12}
            style={styles.iconBtn}
            accessibilityLabel="Notifications"
            accessibilityRole="button"
          >
            <Ionicons
              name="notifications-outline"
              size={24}
              color={colors.primary}
            />
          </Pressable>
          <Pressable
            onPress={() => router.navigate('/cart')}
            hitSlop={12}
            style={[styles.iconBtn, styles.rightIconBtn]}
            accessibilityLabel={
              itemCount > 0
                ? `Shopping cart, ${itemCount} ${itemCount === 1 ? 'item' : 'items'}`
                : 'Shopping cart, empty'
            }
            accessibilityRole="button"
          >
            <Ionicons name="cart-outline" size={24} color={colors.primary} />
            {itemCount > 0 && (
              <View style={styles.badge} accessibilityElementsHidden={true}>
                <Text style={styles.badgeText}>{itemCount}</Text>
              </View>
            )}
          </Pressable>
        </View>
      </View>
      {showSearch && (
        <Pressable
          style={styles.defaultSearchBar}
          onPress={handleSearchPress}
          accessibilityLabel="Search our collection"
          accessibilityRole="search"
        >
          <Ionicons name="search" size={18} color={colors.placeholder} />
          <Text style={styles.defaultSearchPlaceholder}>
            Search our collection…
          </Text>
        </Pressable>
      )}
    </View>
  );
}
