import { type ReactNode, type RefObject, useEffect, useRef } from 'react';
import { Modal, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSheetExitPresence } from '@/hooks/useSheetExitPresence';
import { styles } from './ShipmentFlowSheet.styles';

const SHEET_OPEN_DURATION_MS = 280;
const SHEET_CLOSE_DURATION_MS = 220;

function reportShown(
  shownRef: RefObject<boolean>,
  onShowRef: RefObject<(() => void) | undefined>
) {
  if (shownRef.current) return;
  shownRef.current = true;
  onShowRef.current?.();
}

interface ShipmentFlowSheetPresenceProps {
  // Rendered above the sheet without its slide (e.g. the identifier scanner).
  accessory?: ReactNode;
  children: ReactNode;
  /** Called once the native modal has gone, so another can present. */
  onDismissed?: () => void;
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
  onDismissed,
  onRequestClose,
  onShow,
  visible,
}: ShipmentFlowSheetPresenceProps) {
  const { finishExit, isPresented, reportDismissed } = useSheetExitPresence(
    visible,
    onDismissed
  );
  const onShowRef = useRef(onShow);
  // Whether this presentation has reported itself shown yet.
  const shownRef = useRef(false);

  useEffect(() => {
    onShowRef.current = onShow;
  }, [onShow]);

  // Report each presentation once: from the modal's onShow, or from this
  // backstop on platforms where that event is not delivered.
  useEffect(() => {
    if (!visible) return;
    shownRef.current = false;
    const timer = setTimeout(
      () => reportShown(shownRef, onShowRef),
      SHEET_OPEN_DURATION_MS
    );
    return () => clearTimeout(timer);
  }, [visible]);

  // The modal stays mounted and is hidden through `visible`, so iOS reports
  // the dismissal (onDismiss) before anything else tries to present.
  return (
    <Modal
      animationType="none"
      onDismiss={reportDismissed}
      onRequestClose={onRequestClose}
      onShow={() => reportShown(shownRef, onShowRef)}
      transparent
      visible={isPresented}
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
            ).withCallback((finished) => {
              // An interrupted slide is not a finished close; the presence
              // fallback still releases the modal if nothing completes.
              if (finished) scheduleOnRN(finishExit);
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
