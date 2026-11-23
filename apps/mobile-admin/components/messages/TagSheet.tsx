import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { AppSheetModal } from '@/components/ui/AppSheetModal';
import {
  RADIUS,
  SPACING,
  type ThemeColors,
  TYPOGRAPHY,
} from '@/constants/theme';
import { formatInboxTag } from '@/lib/merchant-inbox-format';
import { INBOX_PRESET_TAGS } from '@/schemas/merchant-inbox';

const MAX_TAGS = 5;

interface TagSheetProps {
  busy: boolean;
  colors: ThemeColors;
  /** Tag slugs already on the chat, as the server returns them. */
  selected: string[];
  /** Resolves true once the tag is saved, false when saving failed. */
  onAdd: (name: string) => Promise<boolean>;
  onClose: () => void;
  onRemove: (slug: string) => void;
  visible: boolean;
}

const sameTag = (slug: string, name: string) =>
  formatInboxTag(slug).toLowerCase() === name.trim().toLowerCase();

/** Pick from a few quick tags or type your own; up to five per chat. */
export function TagSheet({
  busy,
  colors,
  onAdd,
  onClose,
  onRemove,
  selected,
  visible,
}: TagSheetProps) {
  const [custom, setCustom] = useState('');
  const full = selected.length >= MAX_TAGS;

  const extra = selected.filter(
    (slug) => !INBOX_PRESET_TAGS.some((preset) => sameTag(slug, preset))
  );
  const options = [
    ...INBOX_PRESET_TAGS.map((name) => ({
      name,
      slug: selected.find((slug) => sameTag(slug, name)),
    })),
    ...extra.map((slug) => ({ name: formatInboxTag(slug), slug })),
  ];

  const addCustom = async () => {
    const name = custom.trim();
    if (!name || full || busy) return;
    const saved = await onAdd(name);
    // A failed save keeps what was typed, so it can be tried again as it is;
    // text typed since the tap is never wiped.
    if (saved) setCustom((now) => (now.trim() === name ? '' : now));
  };

  return (
    <AppSheetModal
      accessibilityLabel="Chat tags"
      onClose={onClose}
      visible={visible}
    >
      <Text style={[styles.title, { color: colors.text }]}>Tags</Text>
      <Text style={[styles.hint, { color: colors.textSecondary }]}>
        {full
          ? 'This chat has 5 tags. Remove one to add another.'
          : 'Tap to add or remove. Tags help you find chats later.'}
      </Text>
      <View style={styles.chips}>
        {options.map(({ name, slug }) => {
          const on = slug !== undefined;
          return (
            <Pressable
              accessibilityLabel={`${name}${on ? ', selected' : ''}`}
              accessibilityRole="button"
              accessibilityState={{
                selected: on,
                disabled: busy || (!on && full),
              }}
              disabled={busy || (!on && full)}
              key={slug ?? name}
              onPress={() => {
                if (on) onRemove(slug);
                else onAdd(name);
              }}
              style={[
                styles.chip,
                {
                  backgroundColor: on ? colors.primary : colors.card,
                  borderColor: on ? colors.primary : colors.border,
                  opacity: !on && full ? 0.5 : 1,
                },
              ]}
            >
              <Text
                style={{
                  color: on ? colors.textOnPrimary : colors.text,
                  fontFamily: TYPOGRAPHY.fontFamily.semiBold,
                  fontSize: TYPOGRAPHY.size.md,
                }}
              >
                {name}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.inputRow}>
        <TextInput
          accessibilityLabel="New tag"
          editable={!full && !busy}
          maxLength={30}
          onChangeText={setCustom}
          onSubmitEditing={() => {
            addCustom();
          }}
          placeholder="Add your own tag"
          placeholderTextColor={colors.textMuted}
          returnKeyType="done"
          style={[
            styles.input,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              color: colors.text,
            },
          ]}
          value={custom}
        />
        <Pressable
          accessibilityLabel="Add tag"
          accessibilityRole="button"
          disabled={busy || full || custom.trim().length === 0}
          onPress={() => {
            addCustom();
          }}
          style={[
            styles.add,
            {
              backgroundColor: colors.primary,
              opacity: busy || full || custom.trim().length === 0 ? 0.5 : 1,
            },
          ]}
        >
          <Text
            style={{
              color: colors.textOnPrimary,
              fontFamily: TYPOGRAPHY.fontFamily.semiBold,
            }}
          >
            Add
          </Text>
        </Pressable>
      </View>
    </AppSheetModal>
  );
}

const styles = StyleSheet.create({
  add: {
    alignItems: 'center',
    borderRadius: RADIUS.md,
    justifyContent: 'center',
    minHeight: SPACING.touchTarget,
    paddingHorizontal: SPACING.lg,
  },
  chip: {
    alignItems: 'center',
    borderRadius: RADIUS.full,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: SPACING.lg,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginVertical: SPACING.md,
  },
  hint: { fontSize: TYPOGRAPHY.size.md },
  input: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flex: 1,
    fontSize: TYPOGRAPHY.size.md,
    minHeight: SPACING.touchTarget,
    paddingHorizontal: SPACING.md,
  },
  inputRow: { flexDirection: 'row', gap: SPACING.sm },
  title: {
    fontFamily: TYPOGRAPHY.fontFamily.bold,
    fontSize: TYPOGRAPHY.size.lg,
  },
});
