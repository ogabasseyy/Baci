import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, Text, View } from 'react-native';
import { expenseFormStyles } from '@/components/expenses/expense-form.styles';
import { useTheme } from '@/hooks/useTheme';
import type { ExpenseGroup } from '@/schemas/expense-group';

interface ExpenseGroupSelectorProps {
  activeGroups: ExpenseGroup[];
  canEdit: boolean;
  disabled?: boolean;
  onManage: () => void;
  onSelect: (groupId: string | null) => void;
  selectedGroupId: string | null;
}

export function ExpenseGroupSelector({
  activeGroups,
  canEdit,
  disabled = false,
  onManage,
  onSelect,
  selectedGroupId,
}: ExpenseGroupSelectorProps) {
  const { colors } = useTheme();
  const groups = activeGroups.filter((group) => group.archived_at === null);

  return (
    <View style={expenseFormStyles.section}>
      <Text style={[expenseFormStyles.label, { color: colors.textSecondary }]}>
        Group (Optional)
      </Text>
      <View
        accessibilityLabel="Expense group"
        accessibilityRole="radiogroup"
        style={expenseFormStyles.groupChoiceList}
      >
        <Pressable
          accessibilityLabel="No expense group"
          accessibilityRole="radio"
          accessibilityState={{ checked: selectedGroupId === null, disabled }}
          disabled={disabled}
          onPress={() => {
            if (!disabled && selectedGroupId !== null) onSelect(null);
          }}
          style={[
            expenseFormStyles.groupOption,
            {
              backgroundColor: colors.card,
              borderColor:
                selectedGroupId === null ? colors.primary : colors.border,
            },
            disabled && expenseFormStyles.disabled,
          ]}
        >
          <Text style={[expenseFormStyles.optionText, { color: colors.text }]}>
            No group
          </Text>
          <Ionicons
            color={
              selectedGroupId === null ? colors.primary : colors.textSecondary
            }
            name={
              selectedGroupId === null ? 'checkmark-circle' : 'ellipse-outline'
            }
            size={20}
          />
        </Pressable>

        {groups.map((group) => {
          const selected = group.id === selectedGroupId;

          return (
            <Pressable
              accessibilityLabel={`Assign expense to ${group.name} group`}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected, disabled }}
              disabled={disabled}
              key={group.id}
              onPress={() => {
                if (!disabled && !selected) onSelect(group.id);
              }}
              style={[
                expenseFormStyles.groupOption,
                {
                  backgroundColor: colors.card,
                  borderColor: selected ? colors.primary : colors.border,
                },
                disabled && expenseFormStyles.disabled,
              ]}
            >
              <Text
                style={[expenseFormStyles.optionText, { color: colors.text }]}
              >
                {group.name}
              </Text>
              <Ionicons
                color={selected ? colors.primary : colors.textSecondary}
                name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                size={20}
              />
            </Pressable>
          );
        })}
      </View>

      {groups.length === 0 ? (
        <Text
          style={[
            expenseFormStyles.emptyGroupText,
            { color: colors.textSecondary },
          ]}
        >
          No active groups yet
        </Text>
      ) : null}

      {canEdit ? (
        <Pressable
          accessibilityHint="Create, rename, or archive expense groups"
          accessibilityLabel="Manage expense groups"
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={() => {
            if (!disabled) onManage();
          }}
          style={[
            expenseFormStyles.manageGroupsButton,
            disabled && expenseFormStyles.disabled,
          ]}
        >
          <Ionicons color={colors.primary} name="settings-outline" size={18} />
          <Text
            style={[
              expenseFormStyles.manageGroupsText,
              { color: colors.primary },
            ]}
          >
            Manage groups
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
