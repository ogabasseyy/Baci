import { useNavigation } from 'expo-router';
import { useEffect, useEffectEvent } from 'react';

/**
 * Closes a pay sheet when its screen loses focus (e.g. a link opens the
 * wallet on top), as the savings sheet does: a sheet never follows the
 * customer to another screen (Fable walk 14). Safe at any step: closing
 * only drops the sheet's answers; a payment already sent settles on the
 * server and its key stays, so the next tap resumes it.
 */
export function useCloseSheetOnBlur(sheet: {
  step: string;
  close: () => void;
}) {
  const navigation = useNavigation();
  const closeOpen = useEffectEvent(() => {
    if (sheet.step !== 'closed') sheet.close();
  });
  useEffect(
    () => navigation.addListener('blur', () => closeOpen()),
    [navigation]
  );
}
