import { useBottomSheet } from '@gorhom/bottom-sheet';
import { type ReactNode, useContext, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { SavingsSheetPinCancelContext } from '../SavingsSheetPinCancelContext';

type WalletColors = (typeof Colors)['light'];

/** The sheet's handle, top padding and bottom safe area around the step. */
const SHEET_CHROME_HEIGHT = 72;

/**
 * Covers the savings sheet's content and resizes that sheet to fit the PIN
 * step exactly (no empty space below), then back when the step closes.
 */
export function EmbeddedPinStep({
  children,
  colors,
  onParentClose,
}: {
  children: ReactNode;
  colors: WalletColors;
  /** Called when the savings sheet itself is closed under this step. */
  onParentClose?: () => void;
}) {
  const { snapToIndex, snapToPosition } = useBottomSheet();
  const registerCancel = useContext(SavingsSheetPinCancelContext);
  useEffect(() => {
    if (!registerCancel || !onParentClose) return;
    registerCancel(onParentClose);
    return () => registerCancel(null);
  }, [registerCancel, onParentClose]);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (height > 0) snapToPosition(height + SHEET_CHROME_HEIGHT);
  }, [height, snapToPosition]);
  useEffect(() => () => snapToIndex(0), [snapToIndex]);
  return (
    <View
      style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]}
    >
      <View
        testID="pin-step-content"
        onLayout={(event) =>
          setHeight(Math.ceil(event.nativeEvent.layout.height))
        }
      >
        {children}
      </View>
    </View>
  );
}
