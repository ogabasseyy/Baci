import { type ReactNode, useContext, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { SavingsSheetPinCancelContext } from '../SavingsSheetPinCancelContext';
import { SavingsSheetPinHeightContext } from '../SavingsSheetPinHeightContext';

type WalletColors = (typeof Colors)['light'];

/**
 * Covers the savings sheet's content and resizes that sheet to fit the PIN
 * step exactly (no empty space below), then back when the step closes.
 */
export function EmbeddedPinStep({
  children,
  colors,
  holdHeight = false,
  onParentClose,
}: {
  children: ReactNode;
  colors: WalletColors;
  /**
   * A short waiting step (checking the PIN status, approving a new PIN):
   * the sheet keeps the height it has instead of shrinking to the spinner
   * and growing again, so it moves once, to the next real step.
   */
  holdHeight?: boolean;
  /** Called when the savings sheet itself is closed under this step. */
  onParentClose?: () => void;
}) {
  const setSheetPinHeight = useContext(SavingsSheetPinHeightContext);
  const registerCancel = useContext(SavingsSheetPinCancelContext);
  useEffect(() => {
    if (!registerCancel || !onParentClose) return;
    registerCancel(onParentClose);
    return () => registerCancel(null);
  }, [registerCancel, onParentClose]);
  const [height, setHeight] = useState(0);
  // The sheet fits this step through its own snap point, then back when the
  // step closes. Never snapToPosition: Gorhom reads that target as "closed"
  // and closed the whole savings sheet, cancelling the PIN request.
  useEffect(() => {
    if (height > 0) setSheetPinHeight?.(height);
  }, [height, setSheetPinHeight]);
  useEffect(() => () => setSheetPinHeight?.(0), [setSheetPinHeight]);
  return (
    <View
      style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]}
    >
      <View
        testID="pin-step-content"
        onLayout={(event) => {
          // A waiting step's size is never kept: reporting it later, when the
          // hold ends, would move the sheet to a stale height first.
          if (!holdHeight)
            setHeight(Math.ceil(event.nativeEvent.layout.height));
        }}
      >
        {children}
      </View>
    </View>
  );
}
