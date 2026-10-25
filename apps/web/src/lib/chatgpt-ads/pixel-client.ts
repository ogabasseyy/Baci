'use client';

// Owns the browser-only Pixel queue; keep window-backed tracking behind this client boundary.
import { isAnalyticsAllowed } from '@/lib/analytics-consent';

type PixelQueue = ((...args: unknown[]) => void) & { q?: unknown[][] };
type PixelWindow = Window & { oaiq?: PixelQueue };
function queue(): PixelQueue | undefined {
  if (typeof window === 'undefined') return undefined;
  const target = window as PixelWindow;
  if (!target.oaiq) {
    const pending: unknown[][] = [];
    target.oaiq = Object.assign(
      (...args: unknown[]) => {
        pending.push(args);
      },
      { q: pending }
    );
  }
  return target.oaiq;
}
export function setChatgptMeasurementConsent(allowed: boolean): void {
  queue()?.('consent', allowed);
}
export function initializeChatgptPixel(
  pixelId: string,
  allowed: boolean
): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(pixelId)) return;
  const pixel = queue();
  pixel?.('consent', allowed);
  pixel?.('init', { pixelId });
}
export function measureChatgptPage(pixelId: string): void {
  if (!isAnalyticsAllowed()) return;
  queue()?.('measureSingle', pixelId, 'page_viewed', { type: 'contents' });
}
