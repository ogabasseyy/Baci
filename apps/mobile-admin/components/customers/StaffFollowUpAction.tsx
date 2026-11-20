import { Pressable, StyleSheet, Text } from 'react-native';
import { SPACING } from '@/constants/theme';
import { useTheme } from '@/hooks/useTheme';
import {
  STAFF_FOLLOW_UP_LABELS,
  type StaffFollowUp,
} from '@/schemas/staff-follow-up';

interface StaffFollowUpActionProps {
  followUp?: StaffFollowUp;
  viewerId?: string;
  canWrite: boolean;
  onPress: () => void;
}

export function StaffFollowUpAction({
  followUp,
  viewerId,
  canWrite,
  onPress,
}: StaffFollowUpActionProps) {
  const { colors } = useTheme();
  const assigneeId = followUp?.assignee_id;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Open team follow-up details"
      onPress={onPress}
      style={[styles.action, { backgroundColor: colors.card }]}
    >
      <Text style={{ color: colors.text }}>
        {STAFF_FOLLOW_UP_LABELS[followUp?.stage ?? 'needs_follow_up']} ·{' '}
        {assigneeId ? followUp.assignee_name : 'Unassigned'}
      </Text>
      {followUp?.outcome ? (
        <Text style={{ color: colors.textSecondary }} numberOfLines={2}>
          {followUp.outcome}
        </Text>
      ) : null}
      {followUp?.follow_up_on ? (
        <Text style={{ color: colors.textSecondary }}>
          Follow up on {followUp.follow_up_on}
        </Text>
      ) : null}
      <Text style={{ color: colors.gold }}>
        {canWrite && !assigneeId
          ? 'Claim follow-up'
          : canWrite && assigneeId === viewerId
            ? 'Update follow-up'
            : 'View follow-up'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: {
    minHeight: 44,
    padding: SPACING.md,
    borderRadius: 12,
    gap: SPACING.xs,
  },
});
