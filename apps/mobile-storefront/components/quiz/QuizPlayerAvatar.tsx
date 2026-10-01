import { StyleSheet, Text, View } from 'react-native';

const PLAYER_AVATARS = [
  '🧑🏾‍🚀',
  '👩🏽‍💻',
  '🧑🏿‍🎨',
  '👩🏾‍🔬',
  '🧑🏽‍🎤',
  '👩🏿‍🚀',
  '🧑🏾‍🔧',
  '👩🏽‍🚀',
] as const;

function avatarIndex(displayName: string) {
  let hash = 0;
  for (const character of displayName) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  }
  return hash % PLAYER_AVATARS.length;
}

export function QuizPlayerAvatar({
  accentColor,
  displayName,
  surfaceColor,
}: {
  accentColor: string;
  displayName: string;
  surfaceColor: string;
}) {
  return (
    <View
      accessibilityLabel={`Avatar for ${displayName}`}
      style={[
        styles.avatar,
        { backgroundColor: surfaceColor, borderColor: accentColor },
      ]}
    >
      <Text style={styles.emoji}>
        {PLAYER_AVATARS[avatarIndex(displayName)]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    borderRadius: 22,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  emoji: { fontSize: 25 },
});
