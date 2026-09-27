import { Dimensions } from 'react-native';
import {
  CHAT_WIDGET_DEFAULT_BOTTOM_OFFSET,
  CHAT_WIDGET_FAB_SIZE,
} from '@/constants/layout';
import { resolveApiBaseUrl } from '@/lib/api-url';

/**
 * Screens where the chat widget should be hidden:
 * - Checkout flows (form interference, payment focus)
 * - Utility flows (keyboard and sticky payment controls need clear space)
 * - Auth screens (user not yet engaged)
 * - Order success (celebration screen, CTAs prominent)
 * - Modal screens (overlay stacking issues)
 */
export const HIDDEN_ROUTES = [
  '/checkout',
  '/bnpl-checkout',
  '/payment-gateway',
  '/bank-transfer',
  '/crypto-payment',
  '/order-success',
  '/auth/login',
  '/cart',
  '/utilities',
  '/imei-check',
  '/modal',
  '/orders',
  '/search',
  '/account',
  '/quiz',
];

// H24 note: These are intentionally static — used only for FAB initial position
// and PanResponder snap targets set once in useRef. Dynamic checks (e.g. nudge
// positioning) call Dimensions.get('window') at runtime for accuracy.
// useWindowDimensions() cannot be used at module level (hooks require components).
export const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } =
  Dimensions.get('window');

// API base URL - uses the web app's API
export const API_BASE_URL = resolveApiBaseUrl(process.env.EXPO_PUBLIC_API_URL);
export const CHAT_REQUEST_TIMEOUT_MS = 120_000;
export const SANTA_MERCHANT_SLUG_HEADER = 'x-baci-santa-merchant-slug';
export const STOREFRONT_MERCHANT_SLUG_HEADER = 'x-baci-storefront-slug';
const DEFAULT_CHAT_POWERED_BY_LABEL = 'Powered by Ogabassey AI';
export const CHAT_POWERED_BY_LABEL =
  process.env.EXPO_PUBLIC_CHAT_POWERED_BY_LABEL?.trim() ||
  DEFAULT_CHAT_POWERED_BY_LABEL;

// FAB dimensions and margins
export const FAB_SIZE = CHAT_WIDGET_FAB_SIZE;
export const EDGE_MARGIN = 16;
export const SNAP_THRESHOLD = SCREEN_WIDTH / 2;
export { CHAT_WIDGET_DEFAULT_BOTTOM_OFFSET };

// Intermittent nudge constants
export const NUDGE_VISIBLE_DURATION = 10000; // 10 seconds
export const NUDGE_HIDDEN_DURATION = 30000; // 30 seconds
export const NUDGE_INITIAL_DELAY = 5000; // 5 seconds

// Drag & snapping constants for use-draggable-fab
export const GESTURE_MIN_DISTANCE = 8;
export const GESTURE_MAX_TAP_DISTANCE = 8;
export const DISMISS_RADIUS = 80;
export const DISMISS_BOTTOM_OFFSET = 100;
export const TOP_CLAMP = 100;
export const VELOCITY_PROJECTOR_X = 0.08;
export const VELOCITY_PROJECTOR_Y = 0.04;
