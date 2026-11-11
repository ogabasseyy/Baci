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

describe('bugfix: ordinary agents mentioning preview or monitor', () => {
  it('does not drop in-app browsers with those words', () => {
    expect(isBotUserAgent('Mozilla/5.0 MyApp/1.0 Monitor Preview')).toBe(false);
  });
});

describe('bugfix: device names ending in bot', () => {
  it('does not flag an Android phone called CUBOT', () => {
    expect(
      isBotUserAgent('Mozilla/5.0 (Linux; Android 13; CUBOT X30) Chrome/120')
    ).toBe(false);
  });
});

describe('suffixed crawler names', () => {
  it('flags Twitterbot and MJ12bot', () => {
    expect(isBotUserAgent('Twitterbot/1.0')).toBe(true);
    expect(isBotUserAgent('Mozilla/5.0 (compatible; MJ12bot/v1.4.8)')).toBe(
      true
    );
  });
});
