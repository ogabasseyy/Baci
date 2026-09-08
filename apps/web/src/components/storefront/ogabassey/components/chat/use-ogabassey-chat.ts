'use client';

import { useEffect, useRef, useState } from 'react';
import { useCart } from '@/hooks/cart';
import {
  parseSantaActions,
  stripSantaActions,
} from '@/components/storefront/santa-chat/types';
import type { ChatMessage, SantaCartAction } from './types';
import { PROACTIVE_MESSAGES } from './types';
import { requestOgabasseyChatReply } from './request-ogabassey-chat-reply';

interface UseOgabasseyChat {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  messages: ChatMessage[];
  input: string;
  setInput: (value: string) => void;
  isLoading: boolean;
  proactiveMsg: string | null;
  setProactiveMsg: (msg: string | null) => void;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  handleSend: (messageText: string) => Promise<void>;
  handleSubmit: (e: React.FormEvent) => void;
  handleAddSantaWishToCart: (messageIndex: number, actionIndex?: number) => void;
}

export function useOgabasseyChat({ isSanta }: { isSanta: boolean }): UseOgabasseyChat {
  const { addToCart, setIsCartOpen } = useCart();

  const [isOpen, setIsOpenState] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [proactiveMsg, setProactiveMsg] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Proactive Nudge Logic
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!isOpen) {
        const randomMsg = PROACTIVE_MESSAGES[Math.floor(Math.random() * PROACTIVE_MESSAGES.length)];
        setProactiveMsg(randomMsg);
      }
    }, 3000);

    return () => clearTimeout(timer);
  }, []);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Opening the chat is a user event: hide the proactive nudge and seed the
  // welcome message here instead of reacting to `isOpen` in effects.
  const setIsOpen = (open: boolean) => {
    if (open) {
      setProactiveMsg(null);
      setMessages((prev) =>
        prev.length > 0
          ? prev
          : [
              {
                role: 'model',
                text: isSanta
                  ? 'Ho ho ho! How can Santa AI help you today?'
                  : 'Hello! How can I help you today?',
              },
            ]
      );
    }
    setIsOpenState(open);
  };

  // Ref to always read fresh messages (avoids stale closure in handleSend)
  const messagesRef = useRef(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const handleSend = async (messageText: string) => {
    if (!messageText.trim() || isLoading) return;

    const newMessage: ChatMessage = { role: 'user', text: messageText };
    // Capture history before state update to avoid duplication in concurrent renders
    const history = messagesRef.current;
    setMessages((prev) => [...prev, newMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const aiReply = await requestOgabasseyChatReply(
        isSanta,
        history,
        messageText
      );

      // Check if Santa granted wishes (parse every ACTION directive).
      let santaActions: SantaCartAction[] | undefined;
      if (isSanta) {
        const parsedActions = parseSantaActions(aiReply.text);
        if (parsedActions.length > 0) {
          santaActions = parsedActions.map((action) => ({
            productName: action.productName,
            price: action.price,
            added: false,
          }));
        }
      }

      // Clean the response text by removing Santa action directives for display.
      const displayText = stripSantaActions(aiReply.text);

      setMessages((prev) => [
        ...prev,
        {
          role: 'model',
          text: displayText,
          santaActions,
          ...(aiReply.events.length > 0 ? { uiEvents: aiReply.events } : {}),
        },
      ]);
    } catch (error) {
      console.error('Chat error:', error);
      setMessages((prev) => [
        ...prev,
        {
          role: 'model',
          text: isSanta
            ? "Ho ho ho! Santa's workshop is a bit busy right now. Please try again!"
            : "I'm having trouble connecting right now. Please try again later.",
        },
      ]);
    }
    setIsLoading(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSend(input);
  };

  const handleAddSantaWishToCart = (messageIndex: number, actionIndex = 0) => {
    const message = messages[messageIndex];
    const santaAction = Array.isArray(message?.santaActions)
      ? message.santaActions[actionIndex]
      : message?.santaAction;
    if (!santaAction || santaAction.added) return;

    const santaProduct = {
      id: `santa-wish-${Date.now()}`,
      merchant_id: 'ogabassey',
      name: santaAction.productName,
      description: `Santa's special Christmas wish - ${santaAction.productName}`,
      status: 'active' as const,
      price: santaAction.price,
      manage_stock: false,
      stock: 999,
      image: '/african-santa-head.svg',
      imageLarge: '/african-santa-head.svg',
      imageHint: 'Santa wish product',
      brand: 'Ogabassey',
      gtin: '',
      mpn: '',
      slug: 'santa-wish',
      images: [{ url: '/african-santa-head.svg', alt: 'Santa wish', order: 0 }],
    };

    addToCart(santaProduct, 1);

    setMessages((prev) =>
      prev.map((msg, idx) =>
        idx === messageIndex
          ? {
              ...msg,
              // TODO(santa-actions): remove the legacy singular update once
              // all Ogabassey chat consumers read only `santaActions`.
              santaAction: !msg.santaActions && msg.santaAction
                ? { ...msg.santaAction, added: true }
                : msg.santaAction,
              santaActions: msg.santaActions?.map((action, index) =>
                index === actionIndex ? { ...action, added: true } : action
              ),
            }
          : msg
      )
    );

    setIsCartOpen(true);
  };

  return {
    isOpen,
    setIsOpen,
    messages,
    input,
    setInput,
    isLoading,
    proactiveMsg,
    setProactiveMsg,
    messagesEndRef,
    handleSend,
    handleSubmit,
    handleAddSantaWishToCart,
  };
}
