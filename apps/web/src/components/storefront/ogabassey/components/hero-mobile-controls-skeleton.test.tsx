import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  HERO_MOBILE_CONTROLS_ROW_CLASSES,
  HERO_MOBILE_PLAY_TOGGLE_SLOT_CLASSES,
} from './hero-mobile-geometry';
import { HeroMobileControlsSkeleton } from './hero-mobile-controls-skeleton';

function firstClass(token: string): string {
  return (token.split(' ')[0] ?? token).replace(/:/g, '\\:');
}

describe('HeroMobileControlsSkeleton', () => {
  it('renders the shared row geometry visibly by default', () => {
    const { container } = render(<HeroMobileControlsSkeleton />);

    const row = container.querySelector(
      `.${firstClass(HERO_MOBILE_CONTROLS_ROW_CLASSES)}`
    );
    expect(row).not.toBeNull();
    expect(row).toHaveAttribute('aria-hidden', 'true');
    expect(row).not.toHaveClass('invisible');
    // h-11 alone also matches the play-toggle slot; the tracks are the
    // h-11 flex-1 boxes.
    expect(row?.querySelectorAll('.h-11.flex-1')).toHaveLength(3);
    expect(
      row?.querySelector(
        `.${firstClass(HERO_MOBILE_PLAY_TOGGLE_SLOT_CLASSES)}`
      )
    ).not.toBeNull();
  });

  it('reserves the same geometry invisibly for degenerate heroes', () => {
    const { container } = render(<HeroMobileControlsSkeleton invisible />);

    const row = container.querySelector(
      `.${firstClass(HERO_MOBILE_CONTROLS_ROW_CLASSES)}`
    );
    expect(row).not.toBeNull();
    expect(row).toHaveClass('invisible');
  });
});
