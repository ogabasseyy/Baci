import Ionicons from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import {
  ChoiceSheetModal,
  type ChoiceSheetOption,
} from '@/components/ui/ChoiceSheetModal';
import {
  RADIUS,
  SPACING,
  type ThemeColors,
  TYPOGRAPHY,
} from '@/constants/theme';
import { followUpOptions, formatFollowUp } from '@/lib/merchant-inbox-format';
import { isFollowUpDue } from '@/lib/merchant-inbox-sort';
import type {
  InboxConversation,
  InboxPriority,
  InboxUpdate,
} from '@/schemas/merchant-inbox';
import { PRIORITY_LABEL } from './ConversationMeta';
import { TagSheet } from './TagSheet';

interface ConversationActionsProps {
  busy: boolean;
  colors: ThemeColors;
  conversation: InboxConversation;
  /** Rejects when the change could not be saved. */
  onUpdate: (update: InboxUpdate) => Promise<unknown>;
  /** Called after a chat is marked Done, so the screen can step back. */
  onDone: () => void;
}

type PriorityChoice = InboxPriority | 'none';

/** Done, Follow up, Priority and Tags: the few things a busy owner needs. */
export function ConversationActions({
  busy,
  colors,
  conversation,
  onDone,
  onUpdate,
}: ConversationActionsProps) {
  const [tagsOpen, setTagsOpen] = useState(false);
  // Which pick-one sheet is open, with its options fixed at the moment it opened.
  const [picker, setPicker] = useState<{
    kind: 'followUp' | 'priority';
    options: ChoiceSheetOption<string>[];
  } | null>(null);
  const resolved = conversation.status === 'resolved';
  const followUp = !!conversation.followUp && !resolved;
  const tags = conversation.tags ?? [];

  const apply = async (update: InboxUpdate): Promise<boolean> => {
    try {
      await onUpdate(update);
      return true;
    } catch {
      Alert.alert('Could not save', 'Check your connection and try again.');
      return false;
    }
  };

  const toggleDone = async () => {
    const ok = await apply({ status: resolved ? 'open' : 'resolved' });
    if (ok && !resolved) onDone();
  };

  const openFollowUp = () => {
    setPicker({
      kind: 'followUp',
      options: [
        ...followUpOptions().map((o) => ({ label: o.label, value: o.iso })),
        ...(followUp ? [{ label: 'Clear follow-up', value: 'clear' }] : []),
      ],
    });
  };

  const openPriority = () => {
    setPicker({
      kind: 'priority',
      options: [
        { label: 'Urgent', value: 'urgent' },
        { label: 'High', value: 'high' },
        { label: 'Medium', value: 'medium' },
        { label: 'Low', value: 'low' },
        { label: 'No priority', value: 'none' },
      ] satisfies ChoiceSheetOption<PriorityChoice>[],
    });
  };

  const onPick = async (value: string) => {
    const kind = picker?.kind;
    setPicker(null);
    if (kind === 'followUp') {
      await apply({ followUpAt: value === 'clear' ? null : value });
    } else if (kind === 'priority') {
      await apply({
        priority: value === 'none' ? null : (value as InboxPriority),
      });
    }
  };

  const buttons = [
    {
      key: 'done',
      icon: resolved ? 'refresh-outline' : 'checkmark-done-outline',
      label: resolved ? 'Reopen' : 'Done',
      active: false,
      onPress: toggleDone,
    },
    {
      key: 'follow',
      icon: 'alarm-outline',
      label: followUp
        ? formatFollowUp(conversation.snoozedUntil, isFollowUpDue(conversation))
        : 'Follow up',
      active: followUp,
      onPress: async () => openFollowUp(),
    },
    {
      key: 'priority',
      icon: conversation.priority ? 'flag' : 'flag-outline',
      label: conversation.priority
        ? PRIORITY_LABEL[conversation.priority]
        : 'Priority',
      active: !!conversation.priority,
      onPress: async () => openPriority(),
    },
    {
      key: 'tags',
      icon: 'pricetag-outline',
      label: tags.length > 0 ? `Tags (${tags.length})` : 'Tags',
      active: tags.length > 0,
      onPress: async () => setTagsOpen(true),
    },
  ] as const;

  return (
    <>
      <ScrollView
        contentContainerStyle={styles.row}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.bar, { borderBottomColor: colors.border }]}
      >
        {buttons.map((button) => (
          <Pressable
            accessibilityLabel={button.label}
            accessibilityRole="button"
            disabled={busy}
            key={button.key}
            onPress={() => {
              button.onPress();
            }}
            style={[
              styles.button,
              {
                backgroundColor: button.active
                  ? colors.primaryLight
                  : colors.card,
                borderColor: button.active ? colors.primary : colors.border,
                opacity: busy ? 0.6 : 1,
              },
            ]}
          >
            <Ionicons
              color={button.active ? colors.primary : colors.textSecondary}
              name={button.icon}
              size={16}
            />
            <Text
              style={[
                styles.label,
                { color: button.active ? colors.primary : colors.text },
              ]}
            >
              {button.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      <ChoiceSheetModal
        colors={colors}
        message={
          picker?.kind === 'followUp'
            ? 'This chat comes back to the top when it is time.'
            : undefined
        }
        onClose={() => setPicker(null)}
        onSelect={(value) => {
          onPick(value);
        }}
        options={picker?.options ?? []}
        title={picker?.kind === 'priority' ? 'Priority' : 'Follow up'}
        visible={picker !== null}
      />
      <TagSheet
        busy={busy}
        colors={colors}
        onAdd={(name) => {
          apply({ addTags: [name] });
        }}
        onClose={() => setTagsOpen(false)}
        onRemove={(slug) => {
          apply({ removeTags: [slug] });
        }}
        selected={tags}
        visible={tagsOpen}
      />
    </>
  );
}

const styles = StyleSheet.create({
  bar: { borderBottomWidth: StyleSheet.hairlineWidth, flexGrow: 0 },
  button: {
    alignItems: 'center',
    borderRadius: RADIUS.full,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: SPACING.md,
  },
  label: {
    fontFamily: TYPOGRAPHY.fontFamily.semiBold,
    fontSize: TYPOGRAPHY.size.md,
  },
  row: {
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
  },
});
