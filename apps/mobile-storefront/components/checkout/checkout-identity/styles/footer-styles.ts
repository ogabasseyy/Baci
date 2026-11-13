import { palette, SPACING } from '@/constants/Colors';

export const footerStyles = {
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingTop: 8,
    paddingBottom: 8,
    paddingHorizontal: SPACING.lg,
    backgroundColor: palette.gray[50],
    borderTopWidth: 1,
    borderTopColor: palette.gray[100],
  },
  footerText: {
    flexShrink: 1,
    fontSize: 10,
    color: palette.gray[400],
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
  },
} as const;
