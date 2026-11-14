import { usePreventRemove } from 'expo-router/react-navigation';
import { useCloseSheetOnBlur } from '@/components/wallet-pay/use-close-sheet-on-blur';

/**
 * The IMEI screen's navigation guards: back first steps the pay sheet back
 * (or clears a shown result) instead of leaving, and the sheet closes when
 * the screen loses focus to another one.
 */
export function useImeiScreenNavigationGuards(
  sheet: { step: string; back: () => void; close: () => void },
  hasResult: boolean,
  reset: () => void
) {
  usePreventRemove(hasResult || sheet.step !== 'closed', () =>
    sheet.step !== 'closed' ? sheet.back() : reset()
  );
  useCloseSheetOnBlur(sheet);
}
