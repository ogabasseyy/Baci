import { describe, expect, it, vi } from 'vitest';
import { AD_CONFIG } from '../config/ads';
import { defineGptAdSlot } from './define-gpt-ad-slot';

const placement = AD_CONFIG.PRODUCT_GRID_MPU;

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

  it('defines the slot with multi-size desktop and mobile size mappings when configured', () => {
    const slot = { addService: vi.fn(), defineSizeMapping: vi.fn() };
    slot.addService.mockReturnValue(slot);
    const { builder, googletag, pubads } = createGoogleTag(slot);

    const result = defineGptAdSlot(
      googletag,
      '/1/homepage_large_strip',
      'div-gpt-ad-home-strip',
      AD_CONFIG.HOMEPAGE_STRIP
    );

    expect(googletag.defineSlot).toHaveBeenCalledWith(
      '/1/homepage_large_strip',
      [
        [970, 90],
        [728, 90],
      ],
      'div-gpt-ad-home-strip'
    );
    expect(builder.addSize).toHaveBeenCalledWith(
      [768, 0],
      [
        [970, 90],
        [728, 90],
      ]
    );
    expect(builder.addSize).toHaveBeenCalledWith(
      [0, 0],
      [
        [320, 50],
        [300, 50],
      ]
    );
    expect(slot.defineSizeMapping).toHaveBeenCalledWith(['mapping']);
    expect(slot.addService).toHaveBeenCalledWith(pubads);
    expect(result).toBe(slot);
  });

  it('keeps single-tuple size definitions when no multi-size array is configured', () => {
    const slot = { addService: vi.fn(), defineSizeMapping: vi.fn() };
    slot.addService.mockReturnValue(slot);
    const { builder, googletag } = createGoogleTag(slot);

    defineGptAdSlot(
      googletag,
      '/1/in_feed_mpu',
      'div-gpt-ad-grid-mpu-4',
      AD_CONFIG.PRODUCT_GRID_MPU
    );

    expect(googletag.defineSlot).toHaveBeenCalledWith(
      '/1/in_feed_mpu',
      [300, 250],
      'div-gpt-ad-grid-mpu-4'
    );
    expect(builder.addSize).toHaveBeenCalledWith([768, 0], [300, 250]);
    expect(builder.addSize).toHaveBeenCalledWith([0, 0], [300, 250]);
  });

  it('returns null when GPT refuses the definition', () => {
    const { googletag } = createGoogleTag(null);

    expect(
      defineGptAdSlot(googletag, '/1/x', 'div-gpt-ad-x', placement)
    ).toBeNull();
  });
});
