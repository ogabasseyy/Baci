import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
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
  originalGroupId?: string | null;
}

export function useExpenseFormHandlers({
  archiveGroupMutation,
  form,
  originalGroupId = null,
}: UseExpenseFormHandlersInput) {
  const router = useRouter();
  const [isLeaving, setIsLeaving] = useState(false);
  const shouldPreventRemoval = form.isDirty && !isLeaving;

  const navigateBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(admin)/expenses');
    }
  };

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
    navigateBack();
  };

  const close = () => {
    if (shouldPreventRemoval) {
      confirmDiscard(leave);
    } else {
      navigateBack();
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
