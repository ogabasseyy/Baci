import {
  buildCatalogSearchSuggestions,
  type SearchAssistanceProposal,
  type SearchSuggestionProduct,
} from '@baci/shared/lib';
import { Pressable, ScrollView, Text } from 'react-native';
import type Colors from '@/constants/Colors';
export default function SearchAssistance({
  query,
  resultQuery,
  products,
  onApply,
  colors,
  currency = 'NGN',
}: {
  query: string;
  resultQuery: string;
  products: SearchSuggestionProduct[];
  onApply: (proposal: SearchAssistanceProposal) => void;
  colors: (typeof Colors)['light'];
  currency?: string;
}) {
  const suggestions = buildCatalogSearchSuggestions(
    query,
    resultQuery,
    products,
    {
      currency,
    }
  );
  if (!suggestions.length) return null;
  return (
    <ScrollView
      testID="search-suggestion-row"
      horizontal
      keyboardShouldPersistTaps="always"
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0 }}
      contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingTop: 8 }}
    >
      {suggestions.map((suggestion) => (
        <Pressable
          key={suggestion.label}
          accessibilityRole="button"
          accessibilityLabel={`Search suggestion: ${suggestion.label}`}
          onPress={() => onApply(suggestion.proposal)}
          style={{
            borderColor: colors.border,
            borderWidth: 1,
            borderRadius: 20,
            paddingHorizontal: 14,
            minHeight: 44,
            justifyContent: 'center',
            backgroundColor: colors.card,
          }}
        >
          <Text style={{ color: colors.text }}>{suggestion.label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
