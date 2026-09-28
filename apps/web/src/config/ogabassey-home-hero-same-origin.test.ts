import { afterEach, describe, expect, it } from 'vitest';
import { isOgabasseyHomeHeroSameOriginEnabled } from './ogabassey-home-hero-same-origin';

const FLAG = 'NEXT_PUBLIC_OGABASSEY_HOME_HERO_SAME_ORIGIN_ENABLED';

describe('isOgabasseyHomeHeroSameOriginEnabled', () => {
  afterEach(() => {
    delete process.env[FLAG];
  });

  it('defaults off when the flag is unset', () => {
    delete process.env[FLAG];
    expect(isOgabasseyHomeHeroSameOriginEnabled()).toBe(false);
  });

  it('enables only on the exact string "true"', () => {
    process.env[FLAG] = 'true';
    expect(isOgabasseyHomeHeroSameOriginEnabled()).toBe(true);
  });

  it.each([
    '1',
    'TRUE',
    'yes',
    'enabled',
    ' true ',
  ])('stays off for %s', (value) => {
    process.env[FLAG] = value;
    expect(isOgabasseyHomeHeroSameOriginEnabled()).toBe(false);
  });
});
