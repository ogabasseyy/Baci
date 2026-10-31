import BottomSheet, {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetScrollView,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import Ionicons from '@react-native-vector-icons/ionicons';
import { type ReactNode, useEffect, useRef } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RADIUS, SPACING, TYPOGRAPHY } from '@/constants/theme';
import { useSheetExitPresence } from '@/hooks/useSheetExitPresence';
import { logOrderStatusDebug } from './order-status-debug';
import { getStatusDrawerSnapPoints } from './order-status-drawer-snap-points';

interface OrderStatusDrawerFrameProps {
  children: ReactNode;
  closeLabel: string;
  contentRowCount?: number;
  colors: {
    background: string;
    border: string;
    card: string;
    text: string;
    textMuted: string;
  };
  onClose: () => void;
  title: string;
  visible: boolean;
}

export function OrderStatusDrawerFrame({
  children,
  closeLabel,
  contentRowCount = 0,
  colors,
  onClose,
  title,
  visible,
}: OrderStatusDrawerFrameProps) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const snapPoints = getStatusDrawerSnapPoints(
    windowHeight,
    insets.top,
    contentRowCount
  );
  const initialSnapHeight = snapPoints[0];
  const maxSnapHeight = snapPoints.at(-1);
  const containerLayoutState = useSharedValue({
    height: windowHeight,
    offset: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  const visibleRef = useRef(visible);
  const sheetRef = useRef<BottomSheet>(null);
  const { finishExit, isPresented } = useSheetExitPresence(visible);

  useEffect(() => {
    visibleRef.current = visible;
    // Animate the drawer down instead of unmounting it, so anything opened
    // from it can cross-fade in rather than flashing the bare screen.
    if (visible) {
      sheetRef.current?.snapToIndex(0);
    } else {
      sheetRef.current?.close();
    }
  }, [visible]);

  useEffect(() => {
    containerLayoutState.value = {
      height: windowHeight,
      offset: { top: 0, right: 0, bottom: 0, left: 0 },
    };
  }, [containerLayoutState, windowHeight]);

  useEffect(() => {
    logOrderStatusDebug('drawer-frame-visibility-changed', {
      bottomInset: insets.bottom,
      contentRowCount,
      height: initialSnapHeight,
      maxHeight: maxSnapHeight,
      title,
      visible,
      windowHeight,
    });
  }, [
    contentRowCount,
    initialSnapHeight,
    insets.bottom,
    maxSnapHeight,
    title,
    visible,
    windowHeight,
  ]);

  const handleClose = () => {
    logOrderStatusDebug('drawer-frame-close-requested', {
      title,
      visible,
    });

    if (!visibleRef.current) {
      finishExit();
      return;
    }

    onClose();
  };

  const handleIndexChange = (index: number) => {
    logOrderStatusDebug('drawer-frame-index-changed', {
      index,
      title,
      windowHeight,
    });
  };

  const backdropComponent = (props: BottomSheetBackdropProps) => (
    <BottomSheetBackdrop
      {...props}
      appearsOnIndex={0}
      disappearsOnIndex={-1}
      onPress={handleClose}
      opacity={0.52}
      pressBehavior="close"
    />
  );

  if (!isPresented) {
    return null;
  }

  return (
    <View
      accessibilityViewIsModal={true}
      importantForAccessibility="yes"
      pointerEvents="box-none"
      style={[styles.overlayHost, { height: windowHeight }]}
      testID="order-status-drawer-host"
    >
      <BottomSheet
        ref={sheetRef}
        android_keyboardInputMode="adjustResize"
        backdropComponent={backdropComponent}
        backgroundStyle={[
          styles.sheetBackground,
          {
            backgroundColor: colors.background,
            borderColor: colors.border,
          },
        ]}
        containerLayoutState={containerLayoutState}
        enableDynamicSizing={false}
        enablePanDownToClose={true}
        handleIndicatorStyle={[
          styles.handleIndicator,
          { backgroundColor: colors.textMuted },
        ]}
        index={0}
        keyboardBehavior="interactive"
        keyboardBlurBehavior="restore"
        onChange={handleIndexChange}
        onClose={handleClose}
        snapPoints={snapPoints}
      >
        <BottomSheetView
          style={styles.sheetContent}
          testID="order-status-drawer-content"
        >
          <View
            style={[
              styles.header,
              {
                backgroundColor: colors.card,
                borderBottomColor: colors.border,
                paddingTop: Math.max(insets.top * 0.25, SPACING.md),
              },
            ]}
          >
            <View style={styles.headerSide}>
              <Pressable
                accessibilityLabel={closeLabel}
                accessibilityRole="button"
                hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
                onPress={handleClose}
                style={[
                  styles.headerButton,
                  { backgroundColor: `${colors.text}10` },
                ]}
              >
                <Ionicons color={colors.text} name="close" size={20} />
              </Pressable>
            </View>
            <Text
              accessibilityRole="header"
              numberOfLines={1}
              style={[styles.title, { color: colors.text }]}
            >
              {title}
            </Text>
            <View style={styles.headerSide} />
          </View>
          <BottomSheetScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {children}
          </BottomSheetScrollView>
        </BottomSheetView>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  overlayHost: {
    elevation: 50,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 50,
  },
  sheetBackground: {
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  handleIndicator: {
    height: 5,
    width: 46,
  },
  sheetContent: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  header: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: SPACING.md,
    paddingHorizontal: SPACING.lg,
  },
  headerSide: {
    alignItems: 'flex-start',
    justifyContent: 'center',
    minHeight: 36,
    minWidth: 48,
  },
  headerButton: {
    alignItems: 'center',
    borderRadius: RADIUS.full,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  title: {
    flex: 1,
    fontFamily: TYPOGRAPHY.fontFamily.bold,
    fontSize: TYPOGRAPHY.size.xl,
    paddingHorizontal: SPACING.md,
    textAlign: 'center',
  },
});
