import Ionicons from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ExpenseGroupManagerContent } from '@/components/expenses/ExpenseGroupManagerContent';
import { expenseFormStyles } from '@/components/expenses/expense-form.styles';
import { AppSheetModal } from '@/components/ui/AppSheetModal';
import { useTheme } from '@/hooks/useTheme';
import type { ExpenseGroup } from '@/schemas/expense-group';

interface ExpenseGroupManagerSheetProps {
  archiveGroup: (id: string) => Promise<void>;
  canEdit: boolean;
  createGroup: (name: string) => Promise<ExpenseGroup>;
  groups: ExpenseGroup[];
  onClose: () => void;
  renameGroup: (id: string, name: string) => Promise<void>;
  visible: boolean;
}

type BusyAction = 'archive' | 'create' | 'rename' | null;

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Unable to update expense groups. Try again.';
}

export function ExpenseGroupManagerSheet({
  archiveGroup,
  canEdit,
  createGroup,
  groups,
  onClose,
  renameGroup,
  visible,
}: ExpenseGroupManagerSheetProps) {
  const { colors } = useTheme();
  const [archiveTarget, setArchiveTarget] = useState<ExpenseGroup | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [editingGroup, setEditingGroup] = useState<ExpenseGroup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const activeGroups = groups.filter((group) => group.archived_at === null);
  const resetSheetState = () => {
    setArchiveTarget(null);
    setBusyAction(null);
    setEditingGroup(null);
    setError(null);
    setNewGroupName('');
    setRenameValue('');
  };
  const isBusy = busyAction !== null;
  const groupInputStyle = [
    expenseFormStyles.groupInput,
    {
      backgroundColor: colors.inputBg,
      borderColor: colors.border,
      color: colors.text,
    },
  ];
  const primaryButtonStyle = [
    expenseFormStyles.createGroupButton,
    { backgroundColor: colors.primary },
  ];
  const primaryButtonTextStyle = [
    expenseFormStyles.createGroupButtonText,
    { color: colors.textOnPrimary },
  ];

  const handleCreate = async () => {
    const name = newGroupName.trim();
    if (!name || isBusy) return;

    setBusyAction('create');
    setError(null);
    try {
      await createGroup(name);
      setNewGroupName('');
    } catch (createError) {
      setError(getErrorMessage(createError));
    } finally {
      setBusyAction(null);
    }
  };

  const handleRename = async () => {
    const name = renameValue.trim();
    if (!editingGroup || !name || isBusy) return;

    setBusyAction('rename');
    setError(null);
    try {
      await renameGroup(editingGroup.id, name);
      setEditingGroup(null);
      setRenameValue('');
    } catch (renameError) {
      setError(getErrorMessage(renameError));
    } finally {
      setBusyAction(null);
    }
  };

  const handleArchive = async () => {
    if (!archiveTarget || isBusy) return;

    setBusyAction('archive');
    setError(null);
    try {
      await archiveGroup(archiveTarget.id);
      setArchiveTarget(null);
    } catch (archiveError) {
      setError(getErrorMessage(archiveError));
    } finally {
      setBusyAction(null);
    }
  };

  const renderNameForm = ({
    actionText,
    idleActionLabel,
    inputLabel,
    isSubmitting,
    onSubmit,
    placeholder,
    setValue,
    submittingActionLabel,
    value,
  }: {
    actionText: string;
    idleActionLabel: string;
    inputLabel: string;
    isSubmitting: boolean;
    onSubmit: () => void;
    placeholder?: string;
    setValue: (nextValue: string) => void;
    submittingActionLabel: string;
    value: string;
  }) => (
    <View style={expenseFormStyles.createGroupRow}>
      <TextInput
        accessibilityLabel={inputLabel}
        editable={!isBusy}
        maxLength={80}
        onChangeText={setValue}
        placeholder={placeholder}
        placeholderTextColor={colors.textSecondary}
        style={groupInputStyle}
        value={value}
      />
      <Pressable
        accessibilityLabel={
          isSubmitting ? submittingActionLabel : idleActionLabel
        }
        accessibilityRole="button"
        disabled={isBusy || value.trim().length === 0}
        onPress={onSubmit}
        style={primaryButtonStyle}
      >
        {isSubmitting ? (
          <ActivityIndicator color={colors.textOnPrimary} />
        ) : (
          <Text style={primaryButtonTextStyle}>{actionText}</Text>
        )}
      </Pressable>
    </View>
  );

  return (
    <AppSheetModal
      accessibilityLabel="Manage expense groups sheet"
      dismissOnBackdropPress={!isBusy}
      onClose={() => {
        if (isBusy) return;
        resetSheetState();
        onClose();
      }}
      visible={visible}
    >
      <View
        style={[
          expenseFormStyles.sheetHeader,
          { borderBottomColor: colors.border },
        ]}
      >
        <Text style={[expenseFormStyles.sheetTitle, { color: colors.text }]}>
          Manage groups
        </Text>
        <Pressable
          accessibilityLabel="Close expense group manager"
          accessibilityRole="button"
          disabled={isBusy}
          onPress={() => {
            resetSheetState();
            onClose();
          }}
        >
          <Ionicons color={colors.text} name="close" size={24} />
        </Pressable>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled">
        {canEdit
          ? renderNameForm({
              actionText: 'Create',
              idleActionLabel: 'Create expense group',
              inputLabel: 'New expense group name',
              isSubmitting: busyAction === 'create',
              onSubmit: handleCreate,
              placeholder: 'New group name',
              setValue: setNewGroupName,
              submittingActionLabel: 'Creating expense group',
              value: newGroupName,
            })
          : null}

        {error ? (
          <Text
            accessibilityRole="alert"
            style={[expenseFormStyles.groupErrorText, { color: colors.error }]}
          >
            {error}
          </Text>
        ) : null}

        {editingGroup && canEdit
          ? renderNameForm({
              actionText: 'Save',
              idleActionLabel: 'Save group name',
              inputLabel: `New name for ${editingGroup.name} expense group`,
              isSubmitting: busyAction === 'rename',
              onSubmit: handleRename,
              setValue: setRenameValue,
              submittingActionLabel: 'Saving group name',
              value: renameValue,
            })
          : null}

        <ExpenseGroupManagerContent
          activeGroups={activeGroups}
          archiveTarget={archiveTarget}
          busyAction={busyAction}
          canEdit={canEdit}
          colors={colors}
          isBusy={isBusy}
          onArchiveConfirm={handleArchive}
          onArchiveDismiss={() => setArchiveTarget(null)}
          onArchiveSelect={(group) => {
            setArchiveTarget(group);
            setEditingGroup(null);
            setError(null);
          }}
          onRenameSelect={(group) => {
            setArchiveTarget(null);
            setEditingGroup(group);
            setError(null);
            setRenameValue(group.name);
          }}
        />
      </ScrollView>
    </AppSheetModal>
  );
}
