import { useEffect, useRef } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
} from 'react-native-reanimated';
import { SPACING } from '@/constants/theme';
import { useTheme } from '@/hooks/useTheme';
import DomainOptionsSheetActions from './DomainOptionsSheetActions';
import DomainOptionsSheetHeader from './DomainOptionsSheetHeader';
import { domainOptionsSheetStyles } from './domain-options-sheet.styles';
import type { Domain, DomainAction } from './domain-types';

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
  const pendingActionRef = useRef<{
    action: DomainAction;
    domain: Domain;
  } | null>(null);

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
    }
  }, [visible]);

  useEffect(() => {
    if (visible || !pendingActionRef.current) return;

    const runAction = () => {
      if (!isMountedRef.current) return;

      const pendingAction = pendingActionRef.current;
      if (!pendingAction) return;
      pendingActionRef.current = null;
      onAction(pendingAction.action, pendingAction.domain);
    };

    if (
      typeof requestIdleCallback === 'function' &&
      typeof cancelIdleCallback === 'function'
    ) {
      const idleHandle = requestIdleCallback(runAction, { timeout: 500 });
      return () => cancelIdleCallback(idleHandle);
    }

    const timer = setTimeout(runAction, 0);
    return () => clearTimeout(timer);
  }, [onAction, visible]);

  const handleAction = (action: DomainAction) => {
    if (!domain) return;

    pendingActionRef.current = { action, domain };
    onClose();
  };

  if (!domain) return null;

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
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
        <Animated.View
          entering={SlideInDown}
          exiting={SlideOutDown}
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
          <DomainOptionsSheetActions domain={domain} onAction={handleAction} />

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
      </View>
    </Modal>
  );
}
