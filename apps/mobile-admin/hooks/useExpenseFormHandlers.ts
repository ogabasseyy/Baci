import * as ImagePicker from 'expo-image-picker';
import { usePreventRemove, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';
import type { ExpenseEditFormDraft } from '@/schemas/expense-form';
import type { useExpenseFormState } from './useExpenseFormState';

type ExpenseFormController = ReturnType<typeof useExpenseFormState>;

export type ExpenseFormHandlerForm = Pick<
  ExpenseFormController,
  'isDirty' | 'receiptChange' | 'setField' | 'setLocalReceipt'
> & { values: Pick<ExpenseEditFormDraft, 'groupId'> };

type ExpenseDraftSnapshot = Pick<
  ExpenseFormHandlerForm,
  'receiptChange' | 'values'
>;

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
  const [releasedDraft, setReleasedDraft] =
    useState<ExpenseDraftSnapshot | null>(null);
  // A navigation attempt can leave the form open. Protect any subsequent edits.
  const shouldPreventRemoval =
    form.isDirty &&
    (releasedDraft?.values !== form.values ||
      releasedDraft.receiptChange !== form.receiptChange);

  const releaseDraft = () => {
    setReleasedDraft({
      receiptChange: form.receiptChange,
      values: form.values,
    });
  };

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

  const disablePrevention: () => void = usePreventRemove(
    shouldPreventRemoval,
    ({ repeat }) => {
      confirmDiscard(() => {
        releaseDraft();
        repeat();
      });
    }
  );

  const leave = () => {
    releaseDraft();
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
