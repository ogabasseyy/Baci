import { Pressable, Text, View } from 'react-native';
import type { ThemeColors } from '@/constants/theme';
import type { AddressSuggestion } from './new-customer-address-autocomplete';

export function NewCustomerAddressSuggestions({
  colors,
  onSelect,
  suggestions,
}: {
  colors: ThemeColors;
  onSelect: (suggestion: AddressSuggestion) => void;
  suggestions: AddressSuggestion[];
}) {
  if (suggestions.length === 0) return null;
  return (
    <View
      accessibilityLabel="Address suggestions"
      accessibilityRole="list"
      style={{
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderRadius: 12,
        borderWidth: 1,
        marginTop: 8,
        overflow: 'hidden',
      }}
    >
      {suggestions.map((suggestion) => (
        <Pressable
          accessibilityLabel={`Use address ${suggestion.description}`}
          accessibilityRole="button"
          key={suggestion.placeId}
          onPress={() => onSelect(suggestion)}
          style={({ pressed }) => [
            {
              borderBottomColor: colors.border,
              borderBottomWidth: 1,
              paddingHorizontal: 14,
              paddingVertical: 12,
            },
            pressed && { backgroundColor: colors.backgroundLight },
          ]}
        >
          <Text
            numberOfLines={1}
            style={{ color: colors.text, fontWeight: '600' }}
          >
            {suggestion.mainText}
          </Text>
          {suggestion.secondaryText ? (
            <Text
              numberOfLines={1}
              style={{ color: colors.textSecondary, marginTop: 2 }}
            >
              {suggestion.secondaryText}
            </Text>
          ) : null}
        </Pressable>
      ))}
      <View
        style={{
          alignItems: 'center',
          flexDirection: 'row',
          justifyContent: 'center',
          paddingVertical: 10,
        }}
      >
        <Text style={{ color: colors.textSecondary, fontSize: 11 }}>
          Powered by Google
        </Text>
      </View>
    </View>
  );
}
