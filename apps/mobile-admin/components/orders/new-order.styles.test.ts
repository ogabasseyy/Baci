// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { RADIUS, SPACING } from '@/constants/theme';
import { styles } from './new-order.styles';

describe('new-order styles', () => {
  it('keeps the main order shell spacing and card shape stable', () => {
    expect(styles.container).toMatchObject({ flex: 1 });
    expect(styles.content).toMatchObject({
      gap: SPACING.md,
      padding: SPACING.md,
    });
    expect(styles.card).toMatchObject({
      borderRadius: RADIUS.lg,
      overflow: 'hidden',
    });
  });

  it('keeps product rows and quick-add matches scannable', () => {
    expect(styles.listRow).toMatchObject({
      alignItems: 'center',
      flexDirection: 'row',
      gap: 12,
      padding: 16,
    });
    expect(styles.itemCard).toMatchObject({
      alignItems: 'center',
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      flexDirection: 'row',
      padding: 12,
    });
    expect(styles.quickAddMatchRow).toMatchObject({
      alignItems: 'center',
      borderRadius: 12,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 12,
      padding: 12,
    });
  });

  it('keeps the payment footer in normal form flow', () => {
    expect(styles.footer).toMatchObject({
      gap: 16,
      padding: 16,
    });
    expect(styles.footer).not.toHaveProperty('position');
    expect(styles.paymentToggle).toMatchObject({
      borderRadius: RADIUS.lg,
      flexDirection: 'row',
      padding: 4,
    });
    expect(styles.payBtn).toMatchObject({
      alignItems: 'center',
      borderRadius: 100,
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 24,
      paddingVertical: 14,
    });
  });

  it('keeps dialog and sheet inputs finger-friendly', () => {
    expect(styles.dialog).toMatchObject({
      alignSelf: 'center',
      borderRadius: 20,
      gap: 16,
      padding: 24,
      width: '90%',
    });
    expect(styles.sheetInput).toMatchObject({
      borderRadius: 12,
      fontSize: 16,
      marginBottom: 16,
      padding: 16,
    });
    expect(styles.input).toMatchObject({
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 12,
    });
  });
});
