import * as ImagePicker from 'expo-image-picker';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useState } from 'react';
import { Alert } from 'react-native';
import type { ExpenseEditFormDraft } from '@/schemas/expense-form';
import type { useExpenseFormState } from './useExpenseFormState';

type ExpenseFormController = ReturnType<typeof useExpenseFormState>;

export type ExpenseFormHandlerForm = Pick<
  ExpenseFormController,
  'isDirty' | 'setField' | 'setLocalReceipt'
> & { values: Pick<ExpenseEditFormDraft, 'groupId'> };

interface UseExpenseFormHandlersInput {
  archiveGroupMutation: (groupId: string) => Promise<unknown>;
  form: ExpenseFormHandlerForm;
  onNavigateBack: () => void;
  originalGroupId?: string | null;
}

export function useExpenseFormHandlers({
  archiveGroupMutation,
  form,
  onNavigateBack,
  originalGroupId = null,
}: UseExpenseFormHandlersInput) {
  const [isLeaving, setIsLeaving] = useState(false);
  const shouldPreventRemoval = form.isDirty && !isLeaving;

  const archiveGroup = async (groupId: string) => {
    await archiveGroupMutation(groupId);
    if (form.values.groupId === groupId && groupId !== originalGroupId) {
      form.setField('groupId', null);
    }
  };

  const confirmDiscard = (onDiscard: () => void) => {
    Alert.alert('Discard changes?', 'Your unsaved changes will be lost.', [
      { style: 'cancel', text: 'Keep editing' },
      { onPress: onDiscard, style: 'destructive', text: 'Discard' },
    ]);
  };

  const disablePrevention = usePreventRemove(
    shouldPreventRemoval,
    ({ repeat }) => {
      confirmDiscard(() => {
        setIsLeaving(true);
        repeat();
      });
    }
  );

  const leave = () => {
    setIsLeaving(true);
    disablePrevention();
    onNavigateBack();
  };

  const close = () => {
    if (shouldPreventRemoval) {
      confirmDiscard(leave);
    } else {
      onNavigateBack();
    }
  };

  const pickReceipt = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: true,
        aspect: [4, 5],
        mediaTypes: ['images'],
        quality: 0.7,
      });
      const asset = result.assets?.[0];
      if (!result.canceled && asset?.uri) {
        form.setLocalReceipt(asset.uri, {
          fileName: asset.fileName,
          mimeType: asset.mimeType,
        });
      }
    } catch {
      Alert.alert('Receipt unavailable', 'Could not select a receipt image.');
    }
  };

  return { archiveGroup, close, navigateBackAfterSave: leave, pickReceipt };
}
