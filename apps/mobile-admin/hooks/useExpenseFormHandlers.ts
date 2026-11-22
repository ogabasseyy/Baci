import * as ImagePicker from 'expo-image-picker';
import { usePreventRemove, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';
import { parseExpenseAmount } from '@/lib/expense-amount';
import type { ExpenseEditFormDraft } from '@/schemas/expense-form';
import type { useExpenseFormState } from './useExpenseFormState';

type ExpenseFormController = ReturnType<typeof useExpenseFormState>;

export type ExpenseFormHandlerForm = Pick<
  ExpenseFormController,
  'isDirty' | 'reset' | 'setField' | 'setLocalReceipt'
> & { values: Pick<ExpenseEditFormDraft, 'groupId'> };

interface UseExpenseFormHandlersInput {
  archiveGroupMutation: (groupId: string) => Promise<unknown>;
  form: ExpenseFormHandlerForm;
  initialAmountText?: string;
  originalGroupId?: string | null;
}

export function useExpenseFormHandlers({
  archiveGroupMutation,
  form,
  initialAmountText = '',
  originalGroupId = null,
}: UseExpenseFormHandlersInput) {
  const router = useRouter();
  const [amountText, setAmountText] = useState(initialAmountText);
  const [hasSaved, setHasSaved] = useState(false);
  const shouldPreventRemoval = form.isDirty && !hasSaved;

  const changeAmount = (value: string) => {
    setAmountText(value);
    form.setField('amount', parseExpenseAmount(value));
  };

  const discardDraft = () => {
    form.reset();
    setAmountText(initialAmountText);
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
        discardDraft();
        repeat();
      });
    }
  );

  const leave = () => {
    disablePrevention();
    navigateBack();
  };

  const navigateBackAfterSave = () => {
    setHasSaved(true);
    leave();
  };

  const close = () => {
    if (hasSaved) {
      router.replace('/(admin)/expenses');
    } else if (shouldPreventRemoval) {
      confirmDiscard(() => {
        discardDraft();
        leave();
      });
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

  return {
    amountText,
    archiveGroup,
    changeAmount,
    close,
    hasSaved,
    navigateBackAfterSave,
    pickReceipt,
  };
}
