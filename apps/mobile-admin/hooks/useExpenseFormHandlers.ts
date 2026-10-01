import * as ImagePicker from 'expo-image-picker';
import { useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useRef } from 'react';
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
  const navigation = useNavigation();
  const bypassNextPrevent = useRef(false);
  type NavigationAction = Parameters<typeof navigation.dispatch>[0];

  const archiveGroup = async (groupId: string) => {
    await archiveGroupMutation(groupId);
    if (form.values.groupId === groupId && groupId !== originalGroupId) {
      form.setField('groupId', null);
    }
  };

  const close = () => {
    if (!form.isDirty) {
      onNavigateBack();
      return;
    }
    Alert.alert('Discard changes?', 'Your unsaved changes will be lost.', [
      { style: 'cancel', text: 'Keep editing' },
      {
        onPress: () => {
          bypassNextPrevent.current = true;
          onNavigateBack();
        },
        style: 'destructive',
        text: 'Discard',
      },
    ]);
  };
  const handlePreventRemove = (blockedAction?: NavigationAction) => {
    if (bypassNextPrevent.current) {
      bypassNextPrevent.current = false;
      if (blockedAction) navigation.dispatch(blockedAction);
      return;
    }
    const navigateBack = () => {
      if (blockedAction) {
        navigation.dispatch(blockedAction);
        return;
      }
      onNavigateBack();
    };
    if (!form.isDirty) {
      navigateBack();
      return;
    }

    Alert.alert('Discard changes?', 'Your unsaved changes will be lost.', [
      { style: 'cancel', text: 'Keep editing' },
      { onPress: navigateBack, style: 'destructive', text: 'Discard' },
    ]);
  };

  usePreventRemove(form.isDirty, (event) =>
    handlePreventRemove(event?.data?.action)
  );

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

  const navigateBackAfterSave = () => {
    bypassNextPrevent.current = true;
    onNavigateBack();
  };

  return { archiveGroup, close, navigateBackAfterSave, pickReceipt };
}
