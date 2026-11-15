import { StyleSheet } from 'react-native';

/**
 * Side padding of the results card. The finished-screen ad bleeds through
 * exactly this much, so the card and the ad share one number.
 */
export const QUIZ_RESULT_CARD_SIDE_PADDING = 20;

export function createQuizGameplayAdFooterStyles(colors: {
  background: string;
  border: string;
  textSecondary: string;
}) {
  return StyleSheet.create({
    adFrame: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 72,
      width: '100%',
    },
    adFrameInline: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 250,
      width: '100%',
    },
    // The inline ad is a fixed 300pt wide. Bleeding through the results
    // card's 20pt side padding gives it the full screen width, so it fits a
    // 320pt phone.
    inline: {
      alignItems: 'center',
      alignSelf: 'stretch',
      marginHorizontal: -QUIZ_RESULT_CARD_SIDE_PADDING,
      paddingTop: 8,
    },
    footer: {
      alignItems: 'center',
      backgroundColor: colors.background,
      borderTopColor: colors.border,
      borderTopWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 12,
      paddingTop: 16,
    },
    label: {
      alignSelf: 'center',
      color: colors.textSecondary,
      fontSize: 10,
      fontWeight: '600',
      letterSpacing: 0.8,
      marginBottom: 4,
      textTransform: 'uppercase',
    },
  });
}
