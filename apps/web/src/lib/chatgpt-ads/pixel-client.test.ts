import { afterEach, describe, expect, it } from 'vitest';
import {
  initializeChatgptPixel,
  measureChatgptPage,
  setChatgptMeasurementConsent,
} from './pixel-client';

afterEach(() => {
  localStorage.clear();
  delete (window as Window & { oaiq?: unknown }).oaiq;
});
describe('ChatGPT browser Pixel', () => {
  it('defaults to no measurements and honors consent withdrawal', () => {
    initializeChatgptPixel('pixel-a', false);
    const queue = (window as unknown as { oaiq: { q: unknown[][] } }).oaiq.q;
    expect(queue).toEqual([
      ['consent', false],
      ['init', { pixelId: 'pixel-a' }],
    ]);
    measureChatgptPage('pixel-a');
    expect(queue).toHaveLength(2);
    localStorage.setItem(
      'baci-cookie-consent',
      JSON.stringify({
        necessary: true,
        analytics: true,
        marketing: false,
        functional: false,
      })
    );
    initializeChatgptPixel('pixel-a', true);
    measureChatgptPage('pixel-a');
    expect(queue).toContainEqual([
      'measureSingle',
      'pixel-a',
      'page_viewed',
      { type: 'contents' },
    ]);
    setChatgptMeasurementConsent(false);
    expect(queue.at(-1)).toEqual(['consent', false]);
  });
  it('scopes every browser event to the current merchant pixel', () => {
    localStorage.setItem(
      'baci-cookie-consent',
      JSON.stringify({
        necessary: true,
        analytics: true,
        marketing: false,
        functional: false,
      })
    );
    initializeChatgptPixel('pixel-a', true);
    initializeChatgptPixel('pixel-b', true);
    measureChatgptPage('pixel-b');
    const queue = (window as unknown as { oaiq: { q: unknown[][] } }).oaiq.q;
    expect(queue.at(-1)).toEqual([
      'measureSingle',
      'pixel-b',
      'page_viewed',
      { type: 'contents' },
    ]);
    expect(queue.some((args) => args[0] === 'measure')).toBe(false);
  });
});
