import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  runOnJS,
  SlideInDown,
  SlideOutDown,
} from 'react-native-reanimated';
import { isRuntimePlatform } from '@/config/runtime-platform';
import { SPACING } from '@/constants/theme';
import { useTheme } from '@/hooks/useTheme';
import DomainOptionsSheetActions from './DomainOptionsSheetActions';
import DomainOptionsSheetHeader from './DomainOptionsSheetHeader';
import { domainOptionsSheetStyles } from './domain-options-sheet.styles';
import type { Domain, DomainAction } from './domain-types';

const CLOSE_DURATION_MS = 300;

interface DomainOptionsSheetProps {
  visible: boolean;
  domain: Domain | null;
  onClose: () => void;
  onAction: (action: DomainAction, domain: Domain) => void;
}

export default function DomainOptionsSheet({
  visible,
  domain,
  onClose,
  onAction,
}: DomainOptionsSheetProps) {
  const { colors, shadows } = useTheme();
  const isMountedRef = useRef(true);
  const visibleRef = useRef(visible);
  const onActionRef = useRef(onAction);
  const [modalVisible, setModalVisible] = useState(visible);
  const [awaitingDismiss, setAwaitingDismiss] = useState(false);
  const transitionRef = useRef(0);
  const [transition, setTransition] = useState(0);
  const pendingActionRef = useRef<{
    action: DomainAction;
    domain: Domain;
  } | null>(null);

  useLayoutEffect(() => {
    const wasVisible = visibleRef.current;
    visibleRef.current = visible;
    onActionRef.current = onAction;
    if (visible && !wasVisible) {
      transitionRef.current += 1;
      setTransition(transitionRef.current);
    }
  }, [visible, onAction]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      pendingActionRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (visible) {
      pendingActionRef.current = null;
      setAwaitingDismiss(false);
      setModalVisible(true);
    }
  }, [visible]);

  const dispatchPending = () => {
    if (!isMountedRef.current || visibleRef.current) return;
    const pending = pendingActionRef.current;
    pendingActionRef.current = null;
    if (pending) onActionRef.current(pending.action, pending.domain);
  };

  const finishExit = (exitTransition: number) => {
    if (
      !isMountedRef.current ||
      visibleRef.current ||
      transitionRef.current !== exitTransition
    )
      return;
    setAwaitingDismiss(true);
    setModalVisible(false);
  };

  // Android and web do not expose Modal.onDismiss. With native modal animation
  // disabled, wait for the render that removes the modal before dispatching.
  useEffect(() => {
    if (!awaitingDismiss || modalVisible || isRuntimePlatform('ios')) return;
    const afterCommit = () => {
      setAwaitingDismiss(false);
      if (!isMountedRef.current || visibleRef.current) return;
      const pending = pendingActionRef.current;
      pendingActionRef.current = null;
      if (pending) onActionRef.current(pending.action, pending.domain);
    };
    if (
      typeof requestAnimationFrame === 'function' &&
      typeof cancelAnimationFrame === 'function'
    ) {
      const frame = requestAnimationFrame(afterCommit);
      return () => cancelAnimationFrame(frame);
    }
    const timer = setTimeout(afterCommit, 0);
    return () => clearTimeout(timer);
  }, [awaitingDismiss, modalVisible]);

  const handleAction = (action: DomainAction) => {
    if (!domain) return;

    pendingActionRef.current = { action, domain };
    onClose();
  };

  if (!domain) return null;

  return (
    <Modal
      transparent
      visible={visible || modalVisible}
      animationType="none"
      onDismiss={() => {
        if (isRuntimePlatform('ios') && awaitingDismiss) {
          setAwaitingDismiss(false);
          dispatchPending();
        }
      }}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        style={domainOptionsSheetStyles.overlay}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close options"
        accessibilityHint="Closes the domain options menu"
      >
        <Animated.View
          entering={FadeIn}
          exiting={FadeOut}
          style={[
            domainOptionsSheetStyles.backdrop,
            { backgroundColor: 'rgba(0,0,0,0.4)' },
          ]}
        />
      </Pressable>

      <View
        style={domainOptionsSheetStyles.sheetContainer}
        pointerEvents="box-none"
      >
        {visible && (
          <Animated.View
            entering={SlideInDown}
            exiting={SlideOutDown.duration(CLOSE_DURATION_MS).withCallback(
              (finished) => {
                if (finished) runOnJS(finishExit)(transition);
              }
            )}
            style={[
              domainOptionsSheetStyles.sheet,
              { backgroundColor: colors.card, paddingBottom: SPACING.xl * 2 },
              shadows.lg,
            ]}
          >
            <View style={domainOptionsSheetStyles.handleContainer}>
              <View
                style={[
                  domainOptionsSheetStyles.handle,
                  { backgroundColor: colors.border },
                ]}
              />
            </View>

            <DomainOptionsSheetHeader domain={domain} />
            <DomainOptionsSheetActions
              domain={domain}
              onAction={handleAction}
            />

            <View style={domainOptionsSheetStyles.footer}>
              <Pressable
                style={[
                  domainOptionsSheetStyles.cancelButton,
                  { backgroundColor: colors.background },
                ]}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                accessibilityHint="Closes the options menu without making changes"
              >
                <Text
                  style={[
                    domainOptionsSheetStyles.cancelText,
                    { color: colors.text },
                  ]}
                >
                  Cancel
                </Text>
              </Pressable>
            </View>
          </Animated.View>
        )}
      </View>
    </Modal>
  );
}
