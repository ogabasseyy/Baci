import { type ReactNode, useEffect, useRef } from 'react';
import { Modal, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  runOnJS,
  SlideInDown,
  SlideOutDown,
} from 'react-native-reanimated';
import { useSheetExitPresence } from '@/hooks/useSheetExitPresence';
import { styles } from './ShipmentFlowSheet.styles';

const SHEET_OPEN_DURATION_MS = 280;
const SHEET_CLOSE_DURATION_MS = 220;

interface ShipmentFlowSheetPresenceProps {
  // Rendered above the sheet without its slide (e.g. the identifier scanner).
  accessory?: ReactNode;
  children: ReactNode;
  onRequestClose: () => void;
  onShow?: () => void;
  visible: boolean;
}

/**
 * Presents the shipment sheet with a fading backdrop and a sliding sheet, and
 * keeps the modal alive until the slide-out finishes so closing is not abrupt.
 */
export function ShipmentFlowSheetPresence({
  accessory,
  children,
  onRequestClose,
  onShow,
  visible,
}: ShipmentFlowSheetPresenceProps) {
  const { finishExit, isPresented } = useSheetExitPresence(visible);
  const onShowRef = useRef(onShow);

  useEffect(() => {
    onShowRef.current = onShow;
  }, [onShow]);

  // Backstop for platforms where the modal's own onShow event is not
  // delivered; firing it twice is harmless for callers.
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(
      () => onShowRef.current?.(),
      SHEET_OPEN_DURATION_MS
    );
    return () => clearTimeout(timer);
  }, [visible]);

  if (!isPresented) return null;

  return (
    <Modal
      animationType="none"
      onRequestClose={onRequestClose}
      onShow={() => onShowRef.current?.()}
      transparent
      visible
    >
      <View style={styles.overlay}>
        {visible ? (
          <Animated.View
            entering={FadeIn.duration(SHEET_OPEN_DURATION_MS)}
            exiting={FadeOut.duration(SHEET_CLOSE_DURATION_MS)}
            style={styles.backdrop}
          />
        ) : null}
        {visible ? (
          <Animated.View
            entering={SlideInDown.duration(SHEET_OPEN_DURATION_MS)}
            exiting={SlideOutDown.duration(
              SHEET_CLOSE_DURATION_MS
            ).withCallback(() => {
              runOnJS(finishExit)();
            })}
            style={styles.sheetLayer}
          >
            {children}
          </Animated.View>
        ) : null}
        {accessory}
      </View>
    </Modal>
  );
}
