import { Platform, StyleSheet } from 'react-native';
import { palette, RADIUS } from '@/constants/Colors';
import type { useTheme } from '@/hooks/useTheme';
import { getFilterBarShadowStyles } from './FilterBar.shadows';

type ThemeColors = ReturnType<typeof useTheme>['colors'];

const shadowStyles = getFilterBarShadowStyles(
  Platform.OS === 'web' ? 'web' : 'native'
);

// Theme-aware factory so the filter bar surfaces (the panel, category pills,
// price fields, toggles, popover) follow light/dark instead of a hardcoded
// white band. Layout is unchanged; only colors are driven from the theme.
export const getFilterBarStyles = (
  colors: ThemeColors,
  accent = colors.primary
) =>
  StyleSheet.create({
    container: {
      backgroundColor: colors.card,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      zIndex: 1000,
      elevation: 4,
      paddingBottom: 4,
    },
    categoryList: {
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    categoryContent: {
      paddingHorizontal: 12,
      paddingVertical: 10,
      gap: 8,
    },
    catPill: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 99,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 6,
    },
    catPillActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
      ...shadowStyles.catPillActive,
    },
    catText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.text,
      fontFamily: 'serif',
    },
    catTextActive: {
      color: colors.primaryForeground,
    },
    toolsContainer: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      zIndex: 2000,
    },
    mainTools: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      zIndex: 2000,
    },
    filterWrapper: {
      position: 'relative',
      zIndex: 3000,
      elevation: 20,
    },
    filterToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.primaryLowOpacity,
      paddingHorizontal: 8,
      paddingVertical: 6,
      borderRadius: 10,
      gap: 6,
      borderWidth: 1,
      borderColor: colors.primaryLowOpacity,
    },
    filterLabel: {
      fontSize: 12,
      fontWeight: '800',
      color: accent,
      fontFamily: 'serif',
    },
    chevron: {
      marginTop: 1,
    },
    popover: {
      position: 'absolute',
      top: 42,
      left: 0,
      width: 200,
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 6,
      ...shadowStyles.popover,
      borderWidth: 1,
      borderColor: colors.border,
      zIndex: 4000,
    },
    popoverItem: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 10,
      gap: 10,
    },
    popoverItemActive: {
      backgroundColor: colors.primaryLowOpacity,
    },
    popoverText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSecondary,
      fontFamily: 'serif',
    },
    popoverTextActive: {
      color: accent,
      fontWeight: '800',
    },
    checkIcon: {
      marginLeft: 'auto',
    },
    vDivider: {
      width: 1,
      height: 24,
      backgroundColor: colors.border,
    },
    dynamicArea: {
      flex: 1,
      minHeight: 36,
      justifyContent: 'center',
    },
    priceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    priceField: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.muted,
      borderRadius: 8,
      paddingHorizontal: 8,
      height: 32,
    },
    currency: {
      fontSize: 11,
      color: colors.mutedForeground,
      fontWeight: '700',
      marginRight: 2,
    },
    priceInput: {
      flex: 1,
      fontSize: 12,
      fontWeight: '700',
      color: colors.text,
      padding: 0,
      fontFamily: 'serif',
    },
    dash: {
      color: colors.mutedForeground,
      fontWeight: '700',
      fontSize: 10,
    },
    brandScroll: {
      flexGrow: 0,
    },
    brandScrollContent: {
      alignItems: 'center',
      paddingRight: 4,
    },
    brandChip: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: RADIUS.full,
      borderWidth: 1,
      marginRight: 8,
    },
    brandChipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
      ...shadowStyles.brandChipActive,
    },
    brandChipIcon: {
      marginRight: 6,
    },
    brandChipText: {
      fontSize: 11,
      fontWeight: '800',
      fontFamily: 'serif',
    },
    brandChipTextActive: {
      color: colors.primaryForeground,
    },
    brandChipInactive: {
      backgroundColor: colors.card,
      borderColor: colors.border,
    },
    brandChipTextInactive: {
      color: colors.textSecondary,
    },
    conditionSegment: {
      flexDirection: 'row',
      backgroundColor: colors.muted,
      padding: 2,
      borderRadius: 10,
    },
    segmentItem: {
      flex: 1,
      paddingVertical: 6,
      alignItems: 'center',
      borderRadius: 8,
    },
    segmentItemActive: {
      backgroundColor: colors.card,
      ...shadowStyles.segmentItemActive,
    },
    segmentText: {
      fontSize: 10,
      fontWeight: '800',
      color: colors.mutedForeground,
      fontFamily: 'serif',
    },
    segmentTextActive: {
      color: colors.text,
    },
    ratingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    ratingChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 8,
    },
    ratingChipActive: {
      backgroundColor: palette.amber[100],
    },
    ratingText: {
      fontSize: 11,
      fontWeight: '800',
      color: colors.mutedForeground,
      fontFamily: 'serif',
    },
    ratingTextActive: {
      color: palette.amber[700],
    },
    anyText: {
      fontSize: 11,
      color: colors.mutedForeground,
      textDecorationLine: 'underline',
      fontWeight: '600',
    },
    anyTextActive: {
      color: colors.text,
      fontWeight: '800',
    },
    viewToggle: {
      flexDirection: 'row',
      backgroundColor: colors.muted,
      padding: 2,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
    },
    viewBtn: {
      padding: 6,
      borderRadius: 8,
    },
    viewBtnActive: {
      backgroundColor: colors.card,
      ...shadowStyles.viewBtnActive,
    },
    backdrop: {
      position: 'absolute',
      top: -500,
      left: -500,
      right: -500,
      bottom: -1500,
      backgroundColor: 'transparent',
      zIndex: 105,
    },
  });
