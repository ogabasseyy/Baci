import Ionicons from '@react-native-vector-icons/ionicons';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { ExpenseBranchOption } from '@/components/expenses/ExpenseBranchSelector';
import { ExpenseFilterChoice } from '@/components/expenses/ExpenseFilterChoice';
import { EXPENSE_CATEGORIES } from '@/components/expenses/expense-categories';
import {
  DEFAULT_EXPENSE_FILTERS,
  type ExpenseFilters,
} from '@/components/expenses/expense-filters';
import { styles } from '@/components/expenses/expenses-list.styles';
import { AppDatePickerField } from '@/components/ui/AppDatePickerField';
import { AppSheetModal } from '@/components/ui/AppSheetModal';
import { useTheme } from '@/hooks/useTheme';
import { expenseDateCodec } from '@/lib/expense-date';
import type { BranchScope } from '@/schemas/branch';
import type { ExpenseGroup } from '@/schemas/expense-group';

interface ExpenseFiltersSheetProps {
  branchScope: BranchScope;
  branches: ExpenseBranchOption[];
  filters: ExpenseFilters;
  groups: ExpenseGroup[];
  onApply: (filters: ExpenseFilters) => void;
  onClose: () => void;
  onRetry?: () => void;
  visible: boolean;
  dependencyError?: Error | null;
}

type DateField = 'startDate' | 'endDate' | null;

export function ExpenseFiltersSheet({
  branchScope,
  branches,
  filters,
  groups,
  onApply,
  onClose,
  onRetry,
  visible,
  dependencyError = null,
}: ExpenseFiltersSheetProps) {
  const { colors } = useTheme();
  const [draft, setDraft] = useState(filters);
  const [dateField, setDateField] = useState<DateField>(null);
  const lockedBranchName =
    branchScope.type === 'branch'
      ? (branches.find((branch) => branch.id === branchScope.branchId)?.name ??
        'current branch')
      : null;
  const datePickerValue = dateField
    ? (expenseDateCodec.fromDateOnly(draft[dateField] ?? '') ?? new Date())
    : null;

  useEffect(() => {
    if (visible) {
      setDraft(filters);
      setDateField(null);
    }
  }, [filters, visible]);

  const selectDatePreset = (datePreset: ExpenseFilters['datePreset']) => {
    setDraft((current) => ({
      ...current,
      datePreset,
      endDate: datePreset === 'custom' ? current.endDate : null,
      startDate: datePreset === 'custom' ? current.startDate : null,
    }));
  };

  const setFilter = <Key extends keyof ExpenseFilters>(
    key: Key,
    value: ExpenseFilters[Key]
  ) => setDraft((current) => ({ ...current, [key]: value }));

  const selectDate = (date: Date) => {
    if (!dateField) return;

    setDraft((current) => ({
      ...current,
      [dateField]: expenseDateCodec.toDateOnly(date),
    }));
    setDateField(null);
  };

  const apply = () => {
    onApply(draft);
    onClose();
  };

  const reset = () => {
    onApply(DEFAULT_EXPENSE_FILTERS);
    onClose();
  };

  return (
    <AppSheetModal
      accessibilityLabel="Expense filters sheet"
      onClose={onClose}
      visible={visible}
    >
      <View
        style={[styles.filterSheetHeader, { borderBottomColor: colors.border }]}
      >
        <Text style={[styles.filterSheetTitle, { color: colors.text }]}>
          Filters
        </Text>
        <Pressable
          accessibilityLabel="Close expense filters"
          accessibilityRole="button"
          onPress={onClose}
        >
          <Ionicons color={colors.text} name="close" size={24} />
        </Pressable>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled">
        {dependencyError ? (
          <View>
            <Text style={{ color: colors.error }}>
              Some filter options could not load.
            </Text>
            {onRetry ? (
              <Pressable
                accessibilityLabel="Retry loading expense filter options"
                accessibilityRole="button"
                onPress={onRetry}
              >
                <Text style={{ color: colors.primary }}>Retry</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        <Text
          style={[styles.filterSheetLabel, { color: colors.textSecondary }]}
        >
          Date
        </Text>
        <View style={styles.filterChoiceList}>
          {[
            ['all', 'All dates'],
            ['this_month', 'This month'],
            ['last_month', 'Last month'],
            ['custom', 'Custom range'],
          ].map(([value, label]) => {
            const datePreset = value as ExpenseFilters['datePreset'];

            return (
              <ExpenseFilterChoice
                accessibilityLabel={`Select ${label.toLowerCase()}`}
                key={datePreset}
                label={label}
                onPress={() => selectDatePreset(datePreset)}
                selected={draft.datePreset === datePreset}
              />
            );
          })}
        </View>

        {draft.datePreset === 'custom' ? (
          <View style={styles.filterDateRange}>
            {(['startDate', 'endDate'] as const).map((field) => (
              <Pressable
                accessibilityLabel={`Choose filter ${field === 'startDate' ? 'start' : 'end'} date`}
                accessibilityRole="button"
                key={field}
                onPress={() => setDateField(field)}
                style={[
                  styles.filterDateButton,
                  { borderColor: colors.border },
                ]}
              >
                <Text style={{ color: colors.text }}>
                  {draft[field] ??
                    (field === 'startDate' ? 'Start date' : 'End date')}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <Text
          style={[styles.filterSheetLabel, { color: colors.textSecondary }]}
        >
          Category
        </Text>
        <View style={styles.filterChoiceList}>
          {(['all', ...EXPENSE_CATEGORIES] as const).map((category) => (
            <ExpenseFilterChoice
              accessibilityLabel={`Filter category ${category === 'all' ? 'all categories' : category}`}
              key={category}
              label={category === 'all' ? 'All categories' : category}
              onPress={() => setFilter('category', category)}
              selected={draft.category === category}
            />
          ))}
        </View>

        <Text
          style={[styles.filterSheetLabel, { color: colors.textSecondary }]}
        >
          Branch
        </Text>
        {lockedBranchName ? (
          <Text
            style={[styles.lockedBranchText, { color: colors.textSecondary }]}
          >
            Locked to {lockedBranchName}
          </Text>
        ) : (
          <View style={styles.filterChoiceList}>
            <ExpenseFilterChoice
              accessibilityLabel="Filter branch all branches"
              label="All branches"
              onPress={() => setFilter('branchId', 'all')}
              selected={draft.branchId === 'all'}
            />
            {branches.map((branch) => (
              <ExpenseFilterChoice
                accessibilityLabel={`Filter branch ${branch.name}`}
                key={branch.id}
                label={branch.name}
                onPress={() => setFilter('branchId', branch.id)}
                selected={draft.branchId === branch.id}
              />
            ))}
          </View>
        )}

        <Text
          style={[styles.filterSheetLabel, { color: colors.textSecondary }]}
        >
          Group
        </Text>
        <View style={styles.filterChoiceList}>
          <ExpenseFilterChoice
            accessibilityLabel="Filter all expense groups"
            label="All groups"
            onPress={() => setFilter('groupId', 'all')}
            selected={draft.groupId === 'all'}
          />
          <ExpenseFilterChoice
            accessibilityLabel="Filter ungrouped expenses"
            label="Ungrouped"
            onPress={() => setFilter('groupId', 'ungrouped')}
            selected={draft.groupId === 'ungrouped'}
          />
          {groups.map((group) => (
            <ExpenseFilterChoice
              accessibilityLabel={`Filter group ${group.name}`}
              key={group.id}
              label={`${group.name}${group.archived_at ? ' (archived)' : ''}`}
              onPress={() => setFilter('groupId', group.id)}
              selected={draft.groupId === group.id}
            />
          ))}
        </View>

        {dateField && datePickerValue ? (
          <AppDatePickerField
            onClose={() => setDateField(null)}
            onConfirm={selectDate}
            value={datePickerValue}
          />
        ) : null}
      </ScrollView>

      <View style={[styles.filterActions, { borderTopColor: colors.border }]}>
        <Pressable
          accessibilityLabel="Reset expense filters"
          accessibilityRole="button"
          onPress={reset}
          style={[styles.filterResetButton, { borderColor: colors.border }]}
        >
          <Text style={{ color: colors.text }}>Reset</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Apply expense filters"
          accessibilityRole="button"
          onPress={apply}
          style={[
            styles.filterApplyButton,
            { backgroundColor: colors.primary },
          ]}
        >
          <Text style={{ color: colors.textOnPrimary }}>Apply</Text>
        </Pressable>
      </View>
    </AppSheetModal>
  );
}
