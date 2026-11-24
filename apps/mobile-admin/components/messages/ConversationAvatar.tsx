import { StyleSheet, Text, View } from 'react-native';
import { RADIUS, type ThemeColors } from '@/constants/theme';
import { type InboxAvatarTone, inboxAvatar } from '@/lib/merchant-inbox-avatar';

const BACKGROUND = {
  primary: 'primaryLight',
  gold: 'goldLight',
  success: 'successLight',
  warning: 'warningLight',
  error: 'errorLight',
  info: 'infoLight',
} as const satisfies Record<InboxAvatarTone, keyof ThemeColors>;

/** A friendly face for a chat. Decorative: the row's label already names it. */
export function ConversationAvatar({
  colors,
  name,
}: {
  colors: ThemeColors;
  name: string;
}) {
  const { emoji, tone } = inboxAvatar(name);
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[styles.avatar, { backgroundColor: colors[BACKGROUND[tone]] }]}
    >
      <Text style={styles.emoji}>{emoji}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    borderRadius: RADIUS.full,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  emoji: { fontSize: 26 },
});
