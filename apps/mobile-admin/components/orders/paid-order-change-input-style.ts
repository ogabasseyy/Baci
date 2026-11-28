import type { TextStyle } from 'react-native';
import { SPACING, type ThemeColors } from '@/constants/theme';

export function paidOrderChangeInputStyle(colors: ThemeColors): TextStyle {
  return {
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: SPACING.sm,
  };
}
