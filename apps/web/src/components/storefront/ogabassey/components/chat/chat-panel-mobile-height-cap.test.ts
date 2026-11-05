import { describe, expect, it } from 'vitest';
import { getChatPanelMobileHeightCap } from './chat-panel-mobile-height-cap';

describe('getChatPanelMobileHeightCap', () => {
  it('clamps the panel to available viewport height above the cart anchored launcher', () => {
    expect(getChatPanelMobileHeightCap('6.75rem')).toBe(
      'max(0px, calc(100dvh - env(safe-area-inset-bottom, 0px) - 6.75rem - 5.5rem))',
    );
  });
});
