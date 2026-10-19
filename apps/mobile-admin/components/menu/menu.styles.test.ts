import { describe, expect, it } from 'vitest';
import { SPACING, TYPOGRAPHY } from '@/constants/theme';
import { styles } from './menu.styles';

describe('menu styles', () => {
  it('keeps menu rows accessible and section headings compact', () => {
    expect(styles.menuItem).toMatchObject({
      alignItems: 'center',
      flexDirection: 'row',
      minHeight: 56,
      padding: SPACING.md,
    });
    expect(styles.sectionTitle).toMatchObject({
      fontFamily: TYPOGRAPHY.fontFamily.semiBold,
      textTransform: 'uppercase',
    });
  });
});
