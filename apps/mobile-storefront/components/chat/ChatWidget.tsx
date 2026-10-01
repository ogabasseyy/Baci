import Ionicons from '@react-native-vector-icons/ionicons';
import * as Haptics from 'expo-haptics';
import { usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';
import { useColorScheme } from '@/components/useColorScheme';
import Colors, { BRAND } from '@/constants/Colors';
import { getChatWidgetBottomOffset } from '@/constants/layout';
import { getOptionalGestureHandlerRuntime } from '@/lib/optional-gesture-handler';
import { useUIStore } from '@/stores/ui-store';
import { ChatModal } from './ChatModal';
import { EDGE_MARGIN, HIDDEN_ROUTES } from './constants';
import { styles } from './styles';
import type { ChatWidgetProps } from './types';
import { useChat } from './use-chat';
import { useDraggableFab } from './use-draggable-fab';
import { useProactiveNudge } from './use-proactive-nudge';

export function ChatWidget({
  santaMode = false,
  bottomOffset = 90,
}: ChatWidgetProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const pathname = usePathname();
  const previousPathnameRef = useRef<string | null>(null);
  const insets = useSafeAreaInsets();
  const { GestureDetector } = getOptionalGestureHandlerRuntime();
  const effectiveBottomOffset = getChatWidgetBottomOffset(
    bottomOffset,
    insets.bottom
  );

  const {
    isChatOpen,
    openChat,
    closeChat,
    isChatDismissed,
    dismissChat,
    resetChatDismissal,
  } = useUIStore(
    useShallow((state) => ({
      isChatOpen: state.isChatOpen,
      openChat: state.openChat,
      closeChat: state.closeChat,
      isChatDismissed: state.isChatDismissed,
      dismissChat: state.dismissChat,
      resetChatDismissal: state.resetChatDismissal,
    }))
  );

  const isHomeRoute =
    pathname === '/' || pathname === '/(tabs)' || pathname === '/(tabs)/';

  useEffect(() => {
    const previousPathname = previousPathnameRef.current;
    const wasHomeRoute =
      previousPathname === '/' ||
      previousPathname === '/(tabs)' ||
      previousPathname === '/(tabs)/';

    if (isHomeRoute && previousPathname !== null && !wasHomeRoute) {
      resetChatDismissal();
    }

    previousPathnameRef.current = pathname ?? null;
  }, [isHomeRoute, pathname, resetChatDismissal]);

  const {
    composedGesture,
    translateX,
    translateY,
    isDragging,
    isOverDismissZone,
    isOnRight,
  } = useDraggableFab(effectiveBottomOffset, dismissChat, handleOpen);

  const { proactiveMsg, nudgeFadeAnim, dismissNudge } =
    useProactiveNudge(isChatOpen);

  const chat = useChat(santaMode);

  // Check if chat should be hidden on current screen or if dismissed by user
  const shouldHide =
    isChatDismissed ||
    HIDDEN_ROUTES.some((route) => pathname?.startsWith(route));

  const animatedFabStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { translateX: translateX.value },
        { translateY: translateY.value },
      ],
    };
  });

  const animatedNudgeStyle = useAnimatedStyle(() => {
    return {
      opacity: nudgeFadeAnim.value,
    };
  });

  function handleOpen() {
    if (Platform.OS === 'ios') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    openChat();
  }

  const fabStyle = [
    styles.fab,
    {
      backgroundColor: santaMode ? BRAND.primary : colors.card,
      borderColor: isDragging ? BRAND.primary : colors.border,
      borderWidth: isDragging ? 2 : 1,
    },
  ];

  const fabContent = (
    <>
      {santaMode ? (
        <Text style={styles.fabEmoji}>🎅</Text>
      ) : (
        <Ionicons name="sparkles" size={28} color={BRAND.primary} />
      )}
      <View style={styles.aiBadge}>
        <Text style={styles.aiBadgeText}>AI</Text>
      </View>
    </>
  );

  if (shouldHide) {
    return null;
  }

  return (
    <>
      <Animated.View
        style={[
          styles.fabContainer,
          {
            right: EDGE_MARGIN,
            bottom: effectiveBottomOffset,
          },
          animatedFabStyle,
        ]}
      >
        {proactiveMsg && !isChatOpen && !isDragging && (
          <Animated.View
            style={[
              styles.nudgeContainer,
              isOnRight ? styles.nudgeRight : styles.nudgeLeft,
              animatedNudgeStyle,
            ]}
          >
            <View
              style={[
                styles.nudgeBubble,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
              ]}
            >
              <Text style={[styles.nudgeText, { color: colors.text }]}>
                {proactiveMsg}
              </Text>
              <Pressable
                accessibilityLabel="Dismiss chat suggestion"
                accessibilityRole="button"
                style={styles.nudgeClose}
                onPress={dismissNudge}
              >
                <Ionicons name="close" size={10} color={colors.textSecondary} />
              </Pressable>
            </View>
            <View
              style={[
                styles.nudgeTailContainer,
                isOnRight ? styles.nudgeTailRight : styles.nudgeTailLeft,
              ]}
            >
              <View
                style={[
                  styles.nudgeDot1,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              />
              <View
                style={[
                  styles.nudgeDot2,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              />
            </View>
          </Animated.View>
        )}

        {composedGesture ? (
          <GestureDetector gesture={composedGesture}>
            <View
              accessibilityRole="button"
              accessibilityLabel="Open chat assistant. Drag to move."
              accessibilityHint="Double tap to open chat, or drag to reposition"
              accessibilityActions={[
                { name: 'activate', label: 'Open chat assistant' },
              ]}
              onAccessibilityTap={handleOpen}
              onAccessibilityAction={(event) => {
                if (event.nativeEvent.actionName === 'activate') {
                  handleOpen();
                }
              }}
              accessible={true}
            >
              <View style={fabStyle}>{fabContent}</View>
            </View>
          </GestureDetector>
        ) : (
          <View>
            <Pressable
              style={fabStyle}
              onPress={handleOpen}
              accessibilityRole="button"
              accessibilityLabel="Open chat assistant. Drag to move."
              accessibilityHint="Double tap to open chat"
            >
              {fabContent}
            </Pressable>
          </View>
        )}

        {isDragging && (
          <View style={styles.dragIndicator}>
            <Text style={styles.dragIndicatorText}>Drag to move</Text>
          </View>
        )}
      </Animated.View>

      {/* Dynamic Dismiss Zone at bottom center when dragging */}
      {isDragging && (
        <View style={styles.dismissZone}>
          <View
            style={[
              styles.dismissCircle,
              {
                backgroundColor: isOverDismissZone ? '#FF3B30' : colors.card,
                borderColor: '#FF3B30',
                transform: [{ scale: isOverDismissZone ? 1.15 : 1 }],
              },
            ]}
          >
            <Ionicons
              name={isOverDismissZone ? 'trash' : 'trash-outline'}
              size={22}
              color={isOverDismissZone ? '#FFFFFF' : '#FF3B30'}
            />
          </View>
          <Text
            style={[
              styles.dismissText,
              { color: isOverDismissZone ? '#FF3B30' : colors.textSecondary },
            ]}
          >
            {isOverDismissZone ? 'Release to dismiss' : 'Drag here to dismiss'}
          </Text>
        </View>
      )}

      {/* Chat Modal */}
      <ChatModal
        visible={isChatOpen}
        santaMode={santaMode}
        messages={chat.messages}
        input={chat.input}
        isLoading={chat.isLoading}
        flatListRef={chat.flatListRef}
        inputRef={chat.inputRef}
        onClose={closeChat}
        onSend={chat.handleSend}
        onChangeInput={chat.setInput}
        onSuggestionPress={chat.handleSuggestionPress}
        onScrollToBottom={chat.scrollToBottom}
      />
    </>
  );
}
