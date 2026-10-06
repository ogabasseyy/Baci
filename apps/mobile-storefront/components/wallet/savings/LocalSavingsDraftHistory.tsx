import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { SavingsDraft } from '@/schemas/customer-savings-drafts';
import { startSavingsStyles as styles } from './start-savings.styles';
import type { StartSavingsColors } from './start-savings.types';

type LocalSavingsDraftHistoryProps = {
  drafts: SavingsDraft[];
  busy: boolean;
  colors: StartSavingsColors;
  onOpen: (draft: SavingsDraft) => void;
};

export function LocalSavingsDraftHistory(props: LocalSavingsDraftHistoryProps) {
  return props.drafts.length ? <SavedDraftList {...props} /> : null;
}

function SavedDraftList({
  drafts,
  busy,
  colors,
  onOpen,
}: LocalSavingsDraftHistoryProps) {
  const [expanded, setExpanded] = useState(false);
  const toggleLabel = `${expanded ? 'Hide' : 'View'} saved drafts (${drafts.length})`;
  return (
    <View style={styles.section}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={toggleLabel}
        accessibilityState={{ expanded, disabled: busy }}
        disabled={busy}
        onPress={() => setExpanded((current) => !current)}
        style={[styles.outlineButton, { borderColor: colors.border }]}
      >
        <Text style={[styles.outlineButtonText, { color: colors.text }]}>
          {toggleLabel}
        </Text>
      </Pressable>
      {expanded &&
        drafts.map((saved) => (
          <Pressable
            key={saved.draftId}
            accessibilityRole="button"
            accessibilityLabel={`Open ${saved.device.name} · ${saved.device.variantLabel ?? saved.device.condition}`}
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={() => onOpen(saved)}
            style={[
              styles.productSuggestionRow,
              { borderColor: colors.border, backgroundColor: colors.card },
            ]}
          >
            <Text
              style={[styles.productSuggestionName, { color: colors.text }]}
            >
              {saved.device.name}
            </Text>
            <Text
              style={[styles.productMetaText, { color: colors.textSecondary }]}
            >
              {saved.device.variantLabel ?? saved.device.condition}
            </Text>
            <Text
              style={[styles.productMetaText, { color: colors.textSecondary }]}
            >
              {saved.consent === 'accepted'
                ? 'Terms accepted'
                : 'Review terms required'}
            </Text>
            <Text
              style={[styles.productMetaText, { color: colors.textSecondary }]}
            >
              Saved {new Date(saved.createdAt).toLocaleString('en-NG')}
            </Text>
          </Pressable>
        ))}
    </View>
  );
}
