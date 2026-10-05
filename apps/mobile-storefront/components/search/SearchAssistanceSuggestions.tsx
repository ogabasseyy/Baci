import { searchAssistanceQuerySchema } from '@baci/shared/lib';
import type { ComponentProps } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSearchAssistance } from '@/hooks/use-search-assistance';
import SearchAssistance from './SearchAssistance';

export default function SearchAssistanceSuggestions(
  props: ComponentProps<typeof SearchAssistance>
) {
  const assistance = useSearchAssistance(props.query);
  // Same bounds as the request schema (trimmed 2–120 chars plus a catalog
  // term): the length-only gate used to advertise overlong queries that
  // the API always rejects.
  const canAsk =
    assistance.enabled &&
    searchAssistanceQuerySchema.safeParse(props.query).success;
  const actionStyle = {
    minHeight: 44,
    justifyContent: 'center' as const,
    paddingHorizontal: 16,
  };
  return (
    <View>
      <SearchAssistance {...props} />
      {canAsk && (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: assistance.pending }}
          disabled={assistance.pending}
          style={actionStyle}
          onPress={() => void assistance.ask()}
        >
          <Text style={{ color: props.colors.text }}>
            {assistance.pending ? 'Thinking…' : 'Ask about this search'}
          </Text>
        </Pressable>
      )}
      {assistance.error && (
        <Text
          accessibilityRole="alert"
          style={{ color: props.colors.text, paddingHorizontal: 16 }}
        >
          {assistance.error}
        </Text>
      )}
      {assistance.proposal && (
        <View>
          <Text style={{ color: props.colors.text, paddingHorizontal: 16 }}>
            {assistance.proposal.explanation}
          </Text>
          <Pressable
            accessibilityRole="button"
            style={actionStyle}
            onPress={() => {
              if (assistance.proposal) props.onApply(assistance.proposal);
              assistance.dismiss();
            }}
          >
            <Text style={{ color: props.colors.text }}>
              Apply search suggestions
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={actionStyle}
            onPress={assistance.dismiss}
          >
            <Text style={{ color: props.colors.text }}>
              Dismiss suggestions
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
