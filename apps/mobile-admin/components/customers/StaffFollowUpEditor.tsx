import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { AppDatePickerField } from '@/components/ui/AppDatePickerField';
import { AppSheetModal } from '@/components/ui/AppSheetModal';
import { SPACING, TYPOGRAPHY } from '@/constants/theme';
import { useTheme } from '@/hooks/useTheme';
import { getLocalDateKey } from '@/lib/customers-failed-orders';
import {
  limitStaffFollowUpOutcome,
  STAFF_FOLLOW_UP_LABELS,
  type StaffFollowUp,
  type StaffFollowUpStage,
  type StaffFollowUpUpdate,
  staffFollowUpStages,
} from '@/schemas/staff-follow-up';

interface StaffFollowUpEditorProps {
  orderId: string;
  customerName: string;
  followUp?: StaffFollowUp;
  viewerId?: string;
  canWrite: boolean;
  justClaimed?: boolean;
  busy: boolean;
  saveError?: string;
  onClose: () => void;
  onClaim: () => Promise<StaffFollowUp>;
  onSave: (fields: StaffFollowUpUpdate) => Promise<StaffFollowUp>;
}

export function StaffFollowUpEditor({
  orderId,
  customerName,
  followUp,
  viewerId,
  canWrite,
  justClaimed = false,
  busy,
  saveError,
  onClose,
  onClaim,
  onSave,
}: StaffFollowUpEditorProps) {
  const { colors } = useTheme();
  const [draft, setDraft] = useState<{
    stage: StaffFollowUpStage;
    outcome: string;
    dueOn: string | null;
    revision: number | undefined;
  } | null>(null);
  const saved = {
    stage: followUp?.stage ?? 'needs_follow_up',
    outcome: followUp?.outcome ?? '',
    dueOn: followUp?.follow_up_on ?? null,
    revision: followUp?.revision,
  } as const;
  const { stage, outcome, dueOn, revision } = draft ?? saved;
  const editFields = (fields: Partial<typeof saved>) =>
    setDraft({ stage, outcome, dueOn, revision, ...fields });
  const [pickingDate, setPickingDate] = useState(false);
  const [error, setError] = useState('');
  const isClosed = followUp?.stage === 'closed';
  const canClaim = Boolean(
    canWrite && viewerId && !isClosed && !followUp?.assignee_id
  );
  const canEdit = Boolean(
    canWrite && viewerId && !isClosed && followUp?.assignee_id === viewerId
  );

  const stale = draft !== null && (!canEdit || revision !== followUp?.revision);
  const editDisabled = busy || stale;
  const submit = async () => {
    if (editDisabled || (!canClaim && !canEdit)) return;
    setError('');
    try {
      if (!followUp?.assignee_id) await onClaim();
      else {
        await onSave({
          order_id: orderId,
          revision: revision ?? followUp.revision,
          stage,
          outcome: outcome.trim(),
          follow_up_on: stage === 'closed' ? null : dueOn,
        });
        onClose();
      }
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Could not save the follow-up.'
      );
    }
  };

  return (
    <AppSheetModal
      accessibilityLabel="Staff follow-up"
      visible
      onClose={busy ? () => undefined : onClose}
      dismissOnBackdropPress={!busy}
    >
      <View style={styles.content}>
        <Text style={[styles.title, { color: colors.text }]}>
          {customerName}
        </Text>
        <Text style={{ color: colors.textSecondary }}>
          {followUp?.assignee_id
            ? `Handled by ${followUp.assignee_name}`
            : 'Unassigned'}
        </Text>
        {justClaimed && canEdit ? (
          <Text accessibilityRole="alert" style={{ color: colors.success }}>
            You are now handling this follow-up. Add what happened, then save.
          </Text>
        ) : null}
        {canClaim ? (
          <Text style={{ color: colors.textSecondary }}>
            Claim this follow-up first. Then you can record what happened and
            set the next follow-up date.
          </Text>
        ) : null}
        {canEdit || draft ? (
          <>
            <View style={styles.stages}>
              {staffFollowUpStages.map((item) => (
                <Pressable
                  key={item}
                  accessibilityRole="button"
                  accessibilityState={{
                    selected: stage === item,
                    disabled: editDisabled,
                  }}
                  disabled={editDisabled}
                  onPress={() => {
                    editFields({ stage: item });
                    setPickingDate(false);
                  }}
                  style={[
                    styles.option,
                    {
                      borderColor: stage === item ? colors.gold : colors.border,
                    },
                  ]}
                >
                  <Text style={{ color: colors.text }}>
                    {STAFF_FOLLOW_UP_LABELS[item]}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              accessibilityLabel="What happened"
              placeholder="What happened?"
              placeholderTextColor={colors.textSecondary}
              value={outcome}
              onChangeText={(note) =>
                editFields({ outcome: limitStaffFollowUpOutcome(note) })
              }
              editable={!editDisabled}
              multiline
              style={[
                styles.note,
                { color: colors.text, borderColor: colors.border },
              ]}
            />
            {stage === 'closed' && dueOn ? (
              <Text style={{ color: colors.textSecondary }}>
                Closing clears the next follow-up date.
              </Text>
            ) : null}
            {stage !== 'closed' && (
              <>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setPickingDate(true)}
                  disabled={editDisabled}
                  style={styles.option}
                >
                  <Text style={{ color: colors.text }}>
                    {dueOn
                      ? `Follow up on ${dueOn}`
                      : 'Set next follow-up date'}
                  </Text>
                </Pressable>
                {dueOn ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => editFields({ dueOn: null })}
                    disabled={editDisabled}
                    style={styles.option}
                  >
                    <Text style={{ color: colors.text }}>Clear date</Text>
                  </Pressable>
                ) : null}
                {pickingDate && !editDisabled && (
                  <AppDatePickerField
                    value={dueOn ? new Date(`${dueOn}T12:00:00`) : new Date()}
                    onClose={() => setPickingDate(false)}
                    onConfirm={(value) =>
                      editFields({ dueOn: getLocalDateKey(value) })
                    }
                  />
                )}
              </>
            )}
          </>
        ) : (
          <>
            <Text style={{ color: colors.text }}>
              {STAFF_FOLLOW_UP_LABELS[stage]}
            </Text>
            {outcome ? (
              <Text style={{ color: colors.text }}>{outcome}</Text>
            ) : null}
            {dueOn ? (
              <Text style={{ color: colors.text }}>Follow up on {dueOn}</Text>
            ) : null}
          </>
        )}
        {stale ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Discard draft and load saved details"
            accessibilityHint="This follow-up changed while you were editing."
            disabled={busy}
            onPress={() => {
              setDraft(null);
              setPickingDate(false);
              setError('');
            }}
          >
            <Text style={{ color: colors.error }}>
              This follow-up changed while you were editing.
            </Text>
            <Text style={{ color: colors.primary }}>
              Discard draft and load saved details
            </Text>
          </Pressable>
        ) : null}
        {saveError || error ? (
          <Text accessibilityRole="alert" style={{ color: colors.error }}>
            {saveError || error}
          </Text>
        ) : null}
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            disabled={busy}
            style={styles.option}
          >
            <Text style={{ color: colors.text }}>Close</Text>
          </Pressable>
          {canClaim || canEdit ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => void submit()}
              disabled={editDisabled}
              style={[styles.option, { borderColor: colors.gold }]}
            >
              <Text style={{ color: colors.text }}>
                {canEdit ? 'Save follow-up' : 'Claim follow-up'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </AppSheetModal>
  );
}

const styles = StyleSheet.create({
  content: { gap: SPACING.md, padding: SPACING.lg },
  title: {
    fontSize: TYPOGRAPHY.size.lg,
    fontFamily: TYPOGRAPHY.fontFamily.bold,
  },
  stages: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  option: {
    minHeight: 44,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: 8,
    paddingHorizontal: SPACING.sm,
  },
  note: {
    minHeight: 88,
    borderWidth: 1,
    borderRadius: 8,
    padding: SPACING.sm,
    textAlignVertical: 'top',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: SPACING.sm,
  },
});
