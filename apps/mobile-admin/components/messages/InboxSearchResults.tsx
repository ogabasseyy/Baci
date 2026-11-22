import { router } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SPACING, type ThemeColors, TYPOGRAPHY } from '@/constants/theme';
import type { InboxConversation } from '@/schemas/merchant-inbox';
import { ConversationListItem } from './ConversationListItem';

interface InboxSearchResultsProps {
  colors: ThemeColors;
  isError: boolean;
  isLoadingMore: boolean;
  isPending: boolean;
  onLoadMore: () => void;
  results: { conversation: InboxConversation; snippet: string | null }[];
  term: string;
}

/** What the list shows while the search box has text. */
export function InboxSearchResults({
  colors,
  isError,
  isLoadingMore,
  isPending,
  onLoadMore,
  results,
  term,
}: InboxSearchResultsProps) {
  if (term.trim().length < 2) {
    return (
      <View style={styles.centered}>
        <Text style={{ color: colors.textSecondary, textAlign: 'center' }}>
          Type at least 2 letters to search names and messages.
        </Text>
      </View>
    );
  }
  if (isPending) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (isError) {
    return (
      <View style={styles.centered}>
        <Text style={[styles.title, { color: colors.text }]}>
          Search is not available right now.
        </Text>
      </View>
    );
  }
  return (
    <FlatList
      data={results}
      keyboardShouldPersistTaps="handled"
      keyExtractor={(item) => String(item.conversation.id)}
      ListFooterComponent={
        isLoadingMore ? <ActivityIndicator color={colors.primary} /> : undefined
      }
      onEndReached={onLoadMore}
      ListEmptyComponent={
        <View style={styles.centered}>
          <Text style={[styles.title, { color: colors.text }]}>
            No chats match "{term.trim()}"
          </Text>
        </View>
      }
      renderItem={({ item }) => (
        <ConversationListItem
          colors={colors}
          conversation={item.conversation}
          onPress={(id) => router.push(`/(admin)/messages/${id}` as never)}
          snippet={item.snippet}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    gap: SPACING.sm,
    justifyContent: 'center',
    padding: SPACING.xl,
  },
  title: {
    fontFamily: TYPOGRAPHY.fontFamily.semiBold,
    fontSize: TYPOGRAPHY.size.lg,
    textAlign: 'center',
  },
});
