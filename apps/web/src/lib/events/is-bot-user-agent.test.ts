import { describe, expect, it } from 'vitest';
import { isBotUserAgent } from './is-bot-user-agent';

describe('isBotUserAgent', () => {
  it('flags crawlers and monitors', () => {
    expect(isBotUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe(
      true
    );
    expect(isBotUserAgent('HeadlessChrome/120')).toBe(true);
  });
  it('lets real browsers and missing agents through', () => {
    expect(
      isBotUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Safari/604.1'
      )
    ).toBe(false);
    expect(isBotUserAgent(undefined)).toBe(false);
  });
});
