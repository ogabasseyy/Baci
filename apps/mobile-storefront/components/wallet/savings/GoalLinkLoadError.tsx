import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

interface GoalLinkLoadErrorProps {
  onRetry: () => void;
  /** A read that is only slow (no error): offer to keep waiting instead. */
  slow?: boolean;
}

/**
 * Shown when a link to a savings goal arrives but the wallet could not be
 * read. The link is kept: Try again re-reads the wallet and the route then
 * opens the goal (or the plain wallet if the goal is no longer theirs).
 */
export default function GoalLinkLoadError({
  onRetry,
  slow = false,
}: GoalLinkLoadErrorProps) {
  const colors = Colors[useColorScheme() ?? 'light'];
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.text }]}>
        {slow ? 'Still opening your savings' : "Couldn't open your savings"}
      </Text>
      <Text style={[styles.body, { color: colors.textSecondary }]}>
        {slow
          ? 'This is taking longer than usual.'
          : 'Check your connection and try again.'}
      </Text>
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        style={[styles.button, { backgroundColor: colors.primary }]}
      >
        <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>
          {slow ? 'Keep waiting' : 'Try again'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  title: { fontSize: 18, fontWeight: '600', textAlign: 'center' },
  body: { fontSize: 15, textAlign: 'center' },
  button: { borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 },
  buttonText: { fontSize: 16, fontWeight: '600' },
});
