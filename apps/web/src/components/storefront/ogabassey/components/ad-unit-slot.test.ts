import { describe, expect, it, vi } from 'vitest';
import { AD_CONFIG } from '../config/ads';
import { defineGptAdSlot, resolveAdSlotId } from './ad-unit-slot';

const placement = AD_CONFIG.PRODUCT_GRID_MPU;

describe('resolveAdSlotId', () => {
  it('uses the placement id when there is no instance', () => {
    expect(resolveAdSlotId(placement)).toBe('div-gpt-ad-grid-mpu');
  });

  it('gives each repeat of a placement its own id', () => {
    expect(resolveAdSlotId(placement, 4)).toBe('div-gpt-ad-grid-mpu-4');
    expect(resolveAdSlotId(placement, 'cart')).toBe(
      'div-gpt-ad-grid-mpu-cart'
    );
  });

  it('returns undefined for an unknown placement', () => {
    expect(resolveAdSlotId(undefined, 4)).toBeUndefined();
  });
});

describe('defineGptAdSlot', () => {
  function createGoogleTag(slot: unknown) {
    const builder = { addSize: vi.fn(), build: vi.fn(() => ['mapping']) };
    builder.addSize.mockReturnValue(builder);
    const pubads = { name: 'pubads' };
    const googletag = {
      defineSlot: vi.fn(() => slot),
      pubads: vi.fn(() => pubads),
      sizeMapping: vi.fn(() => builder),
    } as unknown as typeof window.googletag;
    return { builder, googletag, pubads };
  }

  it('defines the slot with a desktop and mobile size mapping', () => {
    const slot = { addService: vi.fn(), defineSizeMapping: vi.fn() };
    slot.addService.mockReturnValue(slot);
    const { builder, googletag, pubads } = createGoogleTag(slot);

    const result = defineGptAdSlot(
      googletag,
      '/1/in_feed_mpu',
      'div-gpt-ad-grid-mpu-4',
      AD_CONFIG.HOMEPAGE_STRIP
    );

    expect(googletag.defineSlot).toHaveBeenCalledWith(
      '/1/in_feed_mpu',
      [970, 90],
      'div-gpt-ad-grid-mpu-4'
    );
    expect(builder.addSize).toHaveBeenCalledWith([768, 0], [970, 90]);
    expect(builder.addSize).toHaveBeenCalledWith([0, 0], [320, 50]);
    expect(slot.defineSizeMapping).toHaveBeenCalledWith(['mapping']);
    expect(slot.addService).toHaveBeenCalledWith(pubads);
    expect(result).toBe(slot);
  });

  it('returns null when GPT refuses the definition', () => {
    const { googletag } = createGoogleTag(null);

    expect(
      defineGptAdSlot(googletag, '/1/x', 'div-gpt-ad-x', placement)
    ).toBeNull();
  });
});
