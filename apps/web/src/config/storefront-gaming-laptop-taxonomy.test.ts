import { describe, expect, it } from 'vitest';
import {
  DEDICATED_GAMING_LAPTOP_TOKENS,
  EXCLUDED_CATEGORY_MAP,
  EXCLUDED_GAMING_LAPTOP_SUBJECTS,
  EXCLUDED_HANDHELD_TOKENS,
  GAMING_LAPTOP_EXEMPT_PHRASES,
  NON_EXEMPT_GPU_PHRASES,
  NON_EXEMPT_KEYBOARD_PHRASES,
  NON_EXEMPT_MONITOR_PHRASES,
} from './storefront-gaming-laptop-taxonomy';

describe('storefront-gaming-laptop-taxonomy', () => {
  it('includes core dedicated gaming laptop families and GPUs', () => {
    expect(DEDICATED_GAMING_LAPTOP_TOKENS).toContain('predator');
    expect(DEDICATED_GAMING_LAPTOP_TOKENS).toContain('aorus');
    expect(DEDICATED_GAMING_LAPTOP_TOKENS).toContain('nitro');
    expect(DEDICATED_GAMING_LAPTOP_TOKENS).toContain('blade');
    expect(DEDICATED_GAMING_LAPTOP_TOKENS).toContain('katana');
    expect(DEDICATED_GAMING_LAPTOP_TOKENS).toContain('alienware');
    expect(DEDICATED_GAMING_LAPTOP_TOKENS).toContain('omen');
    expect(DEDICATED_GAMING_LAPTOP_TOKENS).toContain('legion');
    expect(DEDICATED_GAMING_LAPTOP_TOKENS).toContain('rog');
    expect(DEDICATED_GAMING_LAPTOP_TOKENS).toContain('tuf');
    expect(DEDICATED_GAMING_LAPTOP_TOKENS).toContain('raider');
    expect(DEDICATED_GAMING_LAPTOP_TOKENS).toContain('stealth');
    expect(DEDICATED_GAMING_LAPTOP_TOKENS).toContain('titan');
    expect(DEDICATED_GAMING_LAPTOP_TOKENS).toContain('vector');
    expect(DEDICATED_GAMING_LAPTOP_TOKENS).toContain('crosshair');
    expect(DEDICATED_GAMING_LAPTOP_TOKENS).toContain('rtx');
    expect(DEDICATED_GAMING_LAPTOP_TOKENS).toContain('geforce');
  });

  it('contains unique tokens in both dedicated tokens and excluded subjects', () => {
    const tokenSet = new Set(DEDICATED_GAMING_LAPTOP_TOKENS);
    expect(tokenSet.size).toBe(DEDICATED_GAMING_LAPTOP_TOKENS.length);

    const subjectSet = new Set(EXCLUDED_GAMING_LAPTOP_SUBJECTS);
    expect(subjectSet.size).toBe(EXCLUDED_GAMING_LAPTOP_SUBJECTS.length);

    expect(EXCLUDED_GAMING_LAPTOP_SUBJECTS).toContain('cooling pads');
    expect(EXCLUDED_GAMING_LAPTOP_SUBJECTS).toContain('laptop stands');
    expect(EXCLUDED_GAMING_LAPTOP_SUBJECTS).toContain('docking stations');
    expect(EXCLUDED_GAMING_LAPTOP_SUBJECTS).toContain('gaming stands');
    expect(EXCLUDED_GAMING_LAPTOP_SUBJECTS).toContain('laptop chargers');
    expect(EXCLUDED_GAMING_LAPTOP_SUBJECTS).toContain('laptop battery');
    expect(EXCLUDED_GAMING_LAPTOP_SUBJECTS).toContain('laptop keyboards');
    expect(EXCLUDED_GAMING_LAPTOP_SUBJECTS).toContain('keyboard');
    expect(EXCLUDED_GAMING_LAPTOP_SUBJECTS).toContain('gaming keyboards');
    expect(EXCLUDED_GAMING_LAPTOP_SUBJECTS).toContain('rog ally');
    expect(EXCLUDED_GAMING_LAPTOP_SUBJECTS).toContain('steam deck');
  });

  it('declares expected exempt phrases for desktop, monitor, accessory, and battery contexts', () => {
    expect(GAMING_LAPTOP_EXEMPT_PHRASES.desktop).toContain('desktop-class');
    expect(GAMING_LAPTOP_EXEMPT_PHRASES.monitor).toContain('pairing');
    expect(GAMING_LAPTOP_EXEMPT_PHRASES.accessories).toContain(
      'with accessories'
    );
    expect(GAMING_LAPTOP_EXEMPT_PHRASES.battery).toContain('battery life');
  });

  it('declares expected non-exempt phrases and handheld tokens', () => {
    expect(EXCLUDED_HANDHELD_TOKENS).toContain('rog ally');
    expect(NON_EXEMPT_KEYBOARD_PHRASES).toContain('gaming keyboard');
    expect(NON_EXEMPT_GPU_PHRASES).toContain('gaming laptop gpu');
    expect(NON_EXEMPT_MONITOR_PHRASES).toContain('monitor for');
  });

  it('maps excluded subjects to monitors, desktops, and gaming categories', () => {
    const categories = EXCLUDED_CATEGORY_MAP.map(([c]) => c);
    expect(categories).toEqual(['monitors', 'desktops', 'gaming']);
  });
});
