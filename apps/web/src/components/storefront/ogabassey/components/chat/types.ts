import {
  Headphones,
  ShoppingBag,
  Truck,
  Wrench,
  Zap,
} from 'lucide-react';
import { createElement, type ReactElement } from 'react';
import { joinRouteBasePath } from '@/lib/routes';
import type { StorefrontAgentUiEvent } from '@/schemas/storefront-agent-ui-contract';

export interface SantaCartAction {
  productName: string;
  price: number;
  added: boolean;
}

export interface ChatSuggestion {
  label: string;
  icon: ReactElement;
  /**
   * When set, clicking the chip navigates to this storefront-relative path
   * (deep-link) instead of sending the label as a chat message.
   */
  href?: string;
}

/**
 * Resolves a suggestion chip's navigation target against the storefront base
 * path. Returns null for message-sending chips (no href). Kept pure so the
 * deep-link contract is unit-testable without the chat runtime.
 */
export function resolveSuggestionNavigationPath(
  suggestion: Pick<ChatSuggestion, 'href'>,
  basePath: string
): string | null {
  if (!suggestion.href) {
    return null;
  }

  return joinRouteBasePath(basePath, suggestion.href);
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  /** Validated, temporary UI requested by server-owned commerce tool results. */
  uiEvents?: StorefrontAgentUiEvent[];
  /**
   * @deprecated Use `santaActions` for new code. Kept only so older
   * Ogabassey chat message render paths can read previously shaped messages
   * during the multi-action migration.
   */
  santaAction?: SantaCartAction;
  /** All Santa cart actions parsed from one assistant response. */
  santaActions?: SantaCartAction[];
}

export const SUGGESTIONS: ChatSuggestion[] = [
  {
    label: 'Track my order',
    icon: createElement(Truck, { size: 14, className: 'text-red-600' }),
  },
  {
    label: 'Best gaming phones',
    icon: createElement(Zap, { size: 14, className: 'text-red-600' }),
  },
  {
    label: "I've sent my payment",
    icon: createElement(ShoppingBag, { size: 14, className: 'text-red-600' }),
  },
  {
    label: 'Repair quote',
    icon: createElement(Wrench, { size: 14, className: 'text-red-600' }),
    href: '/repairs',
  },
  {
    label: 'Contact support',
    icon: createElement(Headphones, { size: 14, className: 'text-red-600' }),
  },
];

export const PROACTIVE_MESSAGES = [
  "Looking for a new phone? \u{1F4F1}",
  "Need help checking an IMEI? \u{1F50D}",
  "Want to see gaming laptops? \u{1F3AE}",
  "I can help you swap your device! \u{1F504}",
  "Searching for a specific spec? \u26A1",
  "Check out our daily deals! \u{1F3F7}\uFE0F",
  "Need a repair quote? \u{1F527}",
];
