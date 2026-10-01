import { describe, expect, it } from 'vitest';
import {
  isDisplayOnlyVariantAxis,
  isRenderableVariantAxis,
} from './non-renderable-variant-axes';

describe('non-renderable-variant-axes', () => {
  it('filters exact non-renderable metadata axes from rendering regardless of count', () => {
    expect(isRenderableVariantAxis('color', 2)).toBe(false);
    expect(isRenderableVariantAxis('colour', 2)).toBe(false);
    expect(isRenderableVariantAxis('color_hex', 2)).toBe(false);
    expect(isRenderableVariantAxis('availability_note', 1)).toBe(false);
    expect(isRenderableVariantAxis('warranty_note', 1)).toBe(false);
    expect(isRenderableVariantAxis('disclaimer', 1)).toBe(false);
    expect(isRenderableVariantAxis('delivery_notice', 1)).toBe(false);
    expect(isRenderableVariantAxis('note', 2)).toBe(false);
    expect(isRenderableVariantAxis('notice', 2)).toBe(false);
  });

  it('marks informational metadata axes as display-only for commerce', () => {
    expect(isDisplayOnlyVariantAxis('availability_note')).toBe(true);
    expect(isDisplayOnlyVariantAxis('notice')).toBe(true);
    expect(isDisplayOnlyVariantAxis('disclaimer')).toBe(true);
    expect(isDisplayOnlyVariantAxis('color')).toBe(false);
    expect(isDisplayOnlyVariantAxis('storage')).toBe(false);
    expect(isDisplayOnlyVariantAxis('warranty')).toBe(false);
  });

  it('hides single-option warranty as informational metadata but renders multi-option warranty', () => {
    expect(isRenderableVariantAxis('warranty', 1)).toBe(false);
    expect(isRenderableVariantAxis('warranty', 2)).toBe(true);
    expect(isRenderableVariantAxis('warranty', 3)).toBe(true);
  });

  it('keeps legitimate SKU dimensions only when they offer a choice', () => {
    expect(isRenderableVariantAxis('notebook_size', 3)).toBe(true);
    expect(isRenderableVariantAxis('extended_warranty', 1)).toBe(false);
    expect(isRenderableVariantAxis('extended_warranty', 2)).toBe(true);
    expect(isRenderableVariantAxis('noticeable_pattern', 1)).toBe(false);
  });

  it('requires multiple options for condition axis', () => {
    expect(isRenderableVariantAxis('condition', 1)).toBe(false);
    expect(isRenderableVariantAxis('condition', 2)).toBe(true);
  });

  it('renders standard axes only when selection is required', () => {
    expect(isRenderableVariantAxis('storage', 1)).toBe(false);
    expect(isRenderableVariantAxis('ram', 2)).toBe(true);
    expect(isRenderableVariantAxis('storage', 0)).toBe(false);
    expect(isRenderableVariantAxis('', 1)).toBe(false);
  });
});
