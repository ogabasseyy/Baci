import { describe, expect, it } from 'vitest';
import {
  getCartItemConditionBadge,
  resolveCartColorChipStyle,
} from './cart-item-badge-style';

describe('resolveCartColorChipStyle', () => {
  it('prioritizes chromatic names before titanium or natural keywords', () => {
    expect(resolveCartColorChipStyle('Blue Titanium')).toEqual({
      backgroundColor: '#dbeafe',
      color: '#1e40af',
      borderColor: '#93c5fd',
    });
    expect(resolveCartColorChipStyle('Desert Titanium')).toEqual({
      backgroundColor: '#fde68a',
      color: '#78350f',
      borderColor: '#f59e0b',
    });
    expect(resolveCartColorChipStyle('Natural Titanium')).toEqual({
      backgroundColor: '#e5e7eb',
      color: '#1f2937',
      borderColor: '#9ca3af',
    });
  });

  it('matches yellow, silver, black, and white colour families', () => {
    expect(resolveCartColorChipStyle('Yellow')).toMatchObject({
      backgroundColor: '#fef08a',
      color: '#854d0e',
    });
    expect(resolveCartColorChipStyle('Silver')).toMatchObject({
      backgroundColor: '#e4e4e7',
      color: '#27272a',
    });
    expect(resolveCartColorChipStyle('Obsidian Black')).toMatchObject({
      backgroundColor: '#1f2937',
      color: '#ffffff',
    });
    expect(resolveCartColorChipStyle('Starlight White')).toMatchObject({
      backgroundColor: '#ffffff',
      color: '#3f3f46',
    });
  });

  it('supports 3-digit and 6-digit explicit hex fallback with contrast text', () => {
    expect(resolveCartColorChipStyle('Custom Light', '#eee')).toEqual({
      backgroundColor: '#eeeeee',
      color: '#1f2937',
      borderColor: '#d4d4d8',
    });
    expect(resolveCartColorChipStyle('Custom Dark', '#112233')).toEqual({
      backgroundColor: '#112233',
      color: '#ffffff',
      borderColor: '#112233',
    });
    expect(resolveCartColorChipStyle('Blue Custom', '#123456')).toEqual({
      backgroundColor: '#123456',
      color: '#ffffff',
      borderColor: '#123456',
    });
  });
});

describe('getCartItemConditionBadge', () => {
  it('returns themed badge classes for canonical conditions', () => {
    expect(getCartItemConditionBadge({ condition: 'new' })).toEqual({
      label: 'New',
      badgeClassName: 'bg-store-background-text text-store-background',
    });
    expect(
      getCartItemConditionBadge({ variantAttributes: { condition: 'open_box' } })
    ).toEqual({
      label: 'Open Box',
      badgeClassName: 'bg-store-primary text-store-primary-text',
    });
    expect(getCartItemConditionBadge({ condition: 'used' })).toEqual({
      label: 'Used',
      badgeClassName: 'bg-store-background-text/80 text-store-background',
    });
    expect(getCartItemConditionBadge({})).toBeNull();
  });
});
