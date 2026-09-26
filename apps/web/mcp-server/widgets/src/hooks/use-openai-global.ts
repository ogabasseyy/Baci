import { useSyncExternalStore } from 'react';

// Event type for OpenAI global changes
const SET_GLOBALS_EVENT_TYPE = 'openai:setGlobals';

type SetGlobalsEvent = CustomEvent<{
  globals: Partial<OpenAiGlobals>;
}>;

interface OpenAiGlobals {
  toolOutput: unknown;
  toolInput: unknown;
  toolResponseMetadata: unknown;
  widgetState: unknown;
  theme: string;
  displayMode: string;
  maxHeight: number;
  safeArea: { top: number; bottom: number; left: number; right: number };
  locale: string;
}

declare global {
  interface Window {
    openai?: {
      toolOutput?: unknown;
      toolInput?: unknown;
      toolResponseMetadata?: unknown;
      widgetState?: unknown;
      theme?: string;
      displayMode?: string;
      maxHeight?: number;
      safeArea?: { top: number; bottom: number; left: number; right: number };
      locale?: string;
      setWidgetState?: (state: unknown) => void;
      callTool?: (
        name: string,
        args: Record<string, unknown>
      ) => Promise<unknown>;
      openExternal?: (options: { href: string }) => void;
      setOpenInAppUrl?: (options: { href: string }) => void;
      requestModal?: (options: unknown) => void;
      requestDisplayMode?: (options: { mode: 'inline' | 'fullscreen' | 'pip' }) => Promise<unknown>;
      sendFollowUpMessage?: (message: { prompt: string; scrollToBottom?: boolean }) => void;
    };
  }
}

/**
 * Subscribe to a specific key from window.openai
 * Re-renders when that key changes
 */
export function useOpenAiGlobal<K extends keyof OpenAiGlobals>(
  key: K
): OpenAiGlobals[K] | null {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined') {
        return () => {};
      }

      const handleSetGlobal = (event: Event) => {
        const customEvent = event as SetGlobalsEvent;
        const value = customEvent.detail?.globals?.[key];
        if (value === undefined) {
          return;
        }
        onChange();
      };

      window.addEventListener(SET_GLOBALS_EVENT_TYPE, handleSetGlobal, {
        passive: true,
      });

      return () => {
        window.removeEventListener(SET_GLOBALS_EVENT_TYPE, handleSetGlobal);
      };
    },
    () => (window.openai?.[key] ?? null) as OpenAiGlobals[K] | null,
    () => null as OpenAiGlobals[K] | null
  );
}
