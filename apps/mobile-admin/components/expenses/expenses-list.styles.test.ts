import { describe, expect, it } from 'vitest';
import { RADIUS, SPACING, TYPOGRAPHY } from '@/constants/theme';
import { styles } from './expenses-list.styles';

describe('expenses-list styles', () => {
  it('keeps expense rows and the floating action button touch friendly', () => {
    expect(styles.expenseItem).toMatchObject({
      alignItems: 'center',
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      flexDirection: 'row',
      marginBottom: SPACING.md,
      padding: SPACING.md,
    });
    expect(styles.fab).toMatchObject({
      alignItems: 'center',
      bottom: SPACING.xl,
      height: 56,
      justifyContent: 'center',
      position: 'absolute',
      right: SPACING.xl,
      width: 56,
    });
  });

  it('defines compact uppercase section headers for grouped expenses', () => {
    expect(styles.sectionHeader).toMatchObject({
      justifyContent: 'center',
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
    });
    expect(styles.sectionHeaderLabel).toMatchObject({
      fontFamily: TYPOGRAPHY.fontFamily.bold,
      fontSize: TYPOGRAPHY.size.xs,
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    });
  });

  it('keeps the filter control and grouped summary metadata compact', () => {
    expect(styles.filterButton).toMatchObject({
      alignItems: 'center',
      borderRadius: RADIUS.full,
      borderWidth: 1,
      flexDirection: 'row',
      minHeight: SPACING.touchTarget,
    });
    expect(styles.sectionHeaderSummary).toMatchObject({
      flexDirection: 'row',
      gap: SPACING.xs,
    });
  });

  it('keeps the row edit shortcut separate and touch friendly', () => {
    expect(styles.expenseMain).toMatchObject({
      alignItems: 'center',
      flex: 1,
      flexDirection: 'row',
      minHeight: SPACING.touchTarget,
    });
    expect(styles.editButton).toMatchObject({
      alignItems: 'center',
      borderRadius: RADIUS.full,
      borderWidth: 1,
      flexDirection: 'row',
      minHeight: SPACING.touchTarget,
    });
  });
});
