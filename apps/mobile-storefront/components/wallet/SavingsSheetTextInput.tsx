import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { useContext } from 'react';
import { TextInput, type TextInputProps } from 'react-native';
import { SavingsSheetContext } from './SavingsSheetContext';

/** Only inputs inside the savings sheet register with Gorhom's keyboard owner. */
export function SavingsSheetTextInput(props: TextInputProps) {
  const inSheet = useContext(SavingsSheetContext);
  return inSheet ? (
    <BottomSheetTextInput {...props} />
  ) : (
    <TextInput {...props} />
  );
}
