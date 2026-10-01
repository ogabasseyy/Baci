import Ionicons from '@react-native-vector-icons/ionicons';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { expenseFormStyles } from '@/components/expenses/expense-form.styles';
import type { ThemeColors } from '@/constants/theme';
import type { ExpenseGroup } from '@/schemas/expense-group';

interface ExpenseGroupManagerContentProps {
  activeGroups: ExpenseGroup[];
  archiveTarget: ExpenseGroup | null;
  busyAction: 'archive' | 'create' | 'rename' | null;
  canEdit: boolean;
  colors: Pick<
    ThemeColors,
    | 'border'
    | 'card'
    | 'error'
    | 'primary'
    | 'text'
    | 'textOnPrimary'
    | 'textSecondary'
  >;
  isBusy: boolean;
  onArchiveConfirm: () => void;
  onArchiveDismiss: () => void;
  onArchiveSelect: (group: ExpenseGroup) => void;
  onRenameSelect: (group: ExpenseGroup) => void;
}

export function ExpenseGroupManagerContent({
  activeGroups,
  archiveTarget,
  busyAction,
  canEdit,
  colors,
  isBusy,
  onArchiveConfirm,
  onArchiveDismiss,
  onArchiveSelect,
  onRenameSelect,
}: ExpenseGroupManagerContentProps) {
  return (
    <>
      <View style={expenseFormStyles.groupList}>
        {activeGroups.map((group) => (
          <View
            key={group.id}
            style={[
              expenseFormStyles.groupRow,
              { borderBottomColor: colors.border },
            ]}
          >
            <Text
              numberOfLines={1}
              style={[expenseFormStyles.groupName, { color: colors.text }]}
            >
              {group.name}
            </Text>
            {canEdit ? (
              <View style={expenseFormStyles.groupActions}>
                <Pressable
                  accessibilityLabel={`Rename ${group.name} expense group`}
                  accessibilityRole="button"
                  disabled={isBusy}
                  onPress={() => onRenameSelect(group)}
                >
                  <Ionicons color={colors.primary} name="pencil" size={18} />
                </Pressable>
                <Pressable
                  accessibilityLabel={`Archive ${group.name} expense group`}
                  accessibilityRole="button"
                  disabled={isBusy}
                  onPress={() => onArchiveSelect(group)}
                >
                  <Ionicons
                    color={colors.error}
                    name="archive-outline"
                    size={18}
                  />
                </Pressable>
              </View>
            ) : null}
          </View>
        ))}
        {activeGroups.length === 0 ? (
          <Text
            style={[
              expenseFormStyles.emptyGroupText,
              { color: colors.textSecondary },
            ]}
          >
            No active groups yet
          </Text>
        ) : null}
      </View>

      {archiveTarget && canEdit ? (
        <View
          accessibilityRole="alert"
          style={[
            expenseFormStyles.archiveConfirmation,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text
            style={[
              expenseFormStyles.confirmationTitle,
              { color: colors.text },
            ]}
          >
            Archive {archiveTarget.name}?
          </Text>
          <Text
            style={[
              expenseFormStyles.confirmationCopy,
              { color: colors.textSecondary },
            ]}
          >
            Existing expenses keep this group. It will no longer appear when
            adding or editing expenses.
          </Text>
          <View style={expenseFormStyles.confirmationActions}>
            <Pressable
              accessibilityLabel="Cancel archive group"
              accessibilityRole="button"
              disabled={isBusy}
              onPress={onArchiveDismiss}
              style={[
                expenseFormStyles.cancelArchiveButton,
                { borderColor: colors.border },
              ]}
            >
              <Text
                style={[
                  expenseFormStyles.cancelArchiveButtonText,
                  { color: colors.text },
                ]}
              >
                Cancel
              </Text>
            </Pressable>
            <Pressable
              accessibilityLabel={
                busyAction === 'archive'
                  ? 'Archiving expense group'
                  : 'Confirm archive group'
              }
              accessibilityRole="button"
              disabled={isBusy}
              onPress={onArchiveConfirm}
              style={[
                expenseFormStyles.confirmArchiveButton,
                { backgroundColor: colors.error },
              ]}
            >
              {busyAction === 'archive' ? (
                <ActivityIndicator color={colors.textOnPrimary} />
              ) : (
                <Text
                  style={[
                    expenseFormStyles.confirmArchiveButtonText,
                    { color: colors.textOnPrimary },
                  ]}
                >
                  Archive
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      ) : null}
    </>
  );
}
