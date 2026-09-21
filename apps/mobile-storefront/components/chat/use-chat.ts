import { parseSantaActions, stripSantaActions } from '@baci/shared/lib';
import type { FlashListRef } from '@shopify/flash-list';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Platform, type TextInput } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { CONFIG } from '@/lib/config';
import { createLogger } from '@/lib/logger';
import { useUIStore } from '@/stores/ui-store';
import {
  API_BASE_URL,
  CHAT_REQUEST_TIMEOUT_MS,
  SANTA_MERCHANT_SLUG_HEADER,
  STOREFRONT_MERCHANT_SLUG_HEADER,
} from './constants';
import { readChatResponseText } from './read-chat-response';
import { addSantaWishToCart } from './santa-cart';
import type { ChatMessage } from './types';
import { resolveSuggestionRoute, SUGGESTIONS } from './types';

const log = createLogger('ChatWidget');

function createWelcomeMessage(santaMode: boolean): ChatMessage {
  return {
    id: 'welcome',
    role: 'model',
    text: santaMode
      ? 'Ho ho ho! How can Santa AI help you today?'
      : 'Hello! How can I help you today?',
    timestamp: new Date(),
  };
}

type RequestChatReplyArgs = {
  createMessageId: (prefix: 'ai' | 'error') => string;
  history: ChatMessage[];
  messageText: string;
  santaMode: boolean;
  scrollToBottom: () => void;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
};

// Module-scope helper: try/finally cannot live inside the component body
// because React Compiler does not lower TryStatement finalizers yet.
async function requestChatReply({
  createMessageId,
  history,
  messageText,
  santaMode,
  scrollToBottom,
  setIsLoading,
  setMessages,
}: RequestChatReplyArgs): Promise<void> {
  try {
    const endpoint = santaMode
      ? `${API_BASE_URL}/api/chat/santa`
      : `${API_BASE_URL}/api/chat`;

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      CHAT_REQUEST_TIMEOUT_MS
    );

    try {
      const requestBody = {
        messages: [
          ...history.map((m) => ({
            role: m.role === 'model' ? 'assistant' : 'user',
            content: m.text,
          })),
          { role: 'user', content: messageText },
        ],
      };

      const sendRequest = async () => {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/plain',
            'Cache-Control': 'no-cache',
            [STOREFRONT_MERCHANT_SLUG_HEADER]: CONFIG.MERCHANT_SLUG.trim(),
          },
          signal: controller.signal,
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          throw new Error(`Chat service unavailable (${response.status})`);
        }

        const text = await readChatResponseText(response);
        const merchantSlug = response.headers
          .get(SANTA_MERCHANT_SLUG_HEADER)
          ?.trim();
        log.info('Chat response received', {
          endpoint,
          status: response.status,
          length: text.length,
        });

        return { merchantSlug, text };
      };

      let chatReply = await sendRequest();

      if (!chatReply.text) {
        log.warn('Empty chat response, retrying once', { endpoint });
        chatReply = await sendRequest();
      }

      if (!chatReply.text) {
        throw new Error('Empty chat response');
      }
      const aiResponseText = chatReply.text;

      // In Santa mode, fulfil any ADD_TO_CART wish before the directive is
      // stripped from the displayed text. Fire-and-forget so the reply renders
      // immediately; addSantaWishToCart surfaces its own success/error toast.
      if (santaMode) {
        const expectedMerchantSlug = CONFIG.MERCHANT_SLUG.trim();
        const actions = parseSantaActions(aiResponseText);
        if (chatReply.merchantSlug === expectedMerchantSlug) {
          for (const action of actions) {
            void addSantaWishToCart(
              action,
              controller.signal,
              expectedMerchantSlug
            );
          }
        } else if (actions.length > 0) {
          log.warn('Ignoring Santa cart actions for a different storefront', {
            expectedMerchantSlug,
            resolvedMerchantSlug: chatReply.merchantSlug,
          });
        }
      }

      // Clean response text (sanitizeHtml not needed — RN <Text> doesn't execute HTML)
      const displayText = stripSantaActions(aiResponseText);

      const aiMessage: ChatMessage = {
        id: createMessageId('ai'),
        role: 'model',
        text: displayText,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, aiMessage]);

      if (Platform.OS === 'ios') {
        Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success
        ).catch(() => undefined);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    log.error('Chat error:', error);

    const errorMessage: ChatMessage = {
      id: createMessageId('error'),
      role: 'model',
      text: santaMode
        ? "Ho ho ho! Santa's workshop is a bit busy right now. Please try again!"
        : "I'm having trouble connecting right now. Please try again later.",
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, errorMessage]);
  } finally {
    setIsLoading(false);
    scrollToBottom();
  }
}

export function useChat(santaMode: boolean) {
  const { isChatOpen, chatInitialMessage } = useUIStore(
    useShallow((state) => ({
      isChatOpen: state.isChatOpen,
      chatInitialMessage: state.chatInitialMessage,
    }))
  );

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const flatListRef = useRef<FlashListRef<ChatMessage>>(null);
  const inputRef = useRef<TextInput>(null);
  const _msgCounter = useRef(0);

  const scrollToBottom = () => {
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 100);
  };

  // Seed the welcome message inline during render when the chat first opens
  // (react.dev: "Adjusting some state when a prop changes"). The guard on
  // messages.length makes the adjustment converge after one re-render.
  if (isChatOpen && messages.length === 0) {
    setMessages([createWelcomeMessage(santaMode)]);
  }

  const handleSend = (messageText: string) => {
    if (!messageText.trim() || isLoading) return;

    if (Platform.OS === 'ios') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
        () => undefined
      );
    }

    const userMessage: ChatMessage = {
      id: `user-${++_msgCounter.current}`,
      role: 'user',
      text: messageText.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    scrollToBottom();

    // `messages` is the history BEFORE the user message above — the helper
    // appends `messageText` itself, so concurrent renders can't duplicate it.
    void requestChatReply({
      createMessageId: (prefix) => `${prefix}-${++_msgCounter.current}`,
      history: messages,
      messageText,
      santaMode,
      scrollToBottom,
      setIsLoading,
      setMessages,
    });
  };

  // Latest-closure ref so the auto-send effect below keeps a stable dependency
  // set; updated in an effect (never during render).
  const handleSendRef = useRef(handleSend);
  useEffect(() => {
    handleSendRef.current = handleSend;
  });

  // Auto-send initial message if provided by UIStore
  useEffect(() => {
    if (
      isChatOpen &&
      chatInitialMessage &&
      messages.length === 1 &&
      !isLoading
    ) {
      // Clear synchronously first to prevent double-fire if effect re-evaluates
      // during the 500ms delay (e.g. from isLoading or messages.length changes)
      const msg = chatInitialMessage;
      useUIStore.getState().clearChatInitialMessage();

      const timer = setTimeout(() => {
        handleSendRef.current(msg);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [chatInitialMessage, isChatOpen, isLoading, messages.length]);

  const handleSuggestionPress = (suggestion: string) => {
    // Chips with a `route` (e.g. "Repair quote") deep-link to a storefront
    // screen instead of sending the label as a chat message.
    const match = SUGGESTIONS.find((entry) => entry.label === suggestion);
    const route = match ? resolveSuggestionRoute(match) : null;
    if (route) {
      router.push(route);
      return;
    }

    handleSend(suggestion);
  };

  return {
    messages,
    input,
    setInput,
    isLoading,
    flatListRef,
    inputRef,
    handleSend,
    handleSuggestionPress,
    scrollToBottom,
  };
}
