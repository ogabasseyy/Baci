import { describe, expect, it, jest } from '@jest/globals';
import { isValidElement } from 'react';

jest.mock('expo-router', () => ({
  Stack: {
    Screen: function StackScreen() {
      return null;
    },
  },
}));

import { renderRootStackScreens } from './RootStackScreens';
import { getRootStackScreenOptions } from './root-stack-screen-options';

const options = getRootStackScreenOptions({
  background: '#fff',
  text: '#000',
}) as Record<string, unknown>;

describe('root stack header policy', () => {
  it('uses the minimal back control so the previous title is never repeated', () => {
    expect(options.headerBackButtonDisplayMode).toBe('minimal');
    // An empty headerBackTitle is ignored by iOS and re-shows the prior title.
    expect(options).not.toHaveProperty('headerBackTitle');
  });

  it('never sets a header action globally (gear is per-screen opt-in)', () => {
    expect(options).not.toHaveProperty('headerRight');
    expect(options).not.toHaveProperty('headerLeft');
  });

  it('registers no gear / headerRight on any root route, incl. settings, wallet, checkout and payment flows', () => {
    const screens = renderRootStackScreens({
      mutedContentBackgroundColor: '#eee',
    });
    for (const screen of screens) {
      expect(isValidElement(screen)).toBe(true);
      const props = screen.props as { options?: Record<string, unknown> };
      expect(props.options ?? {}).not.toHaveProperty('headerRight');
      expect(props.options ?? {}).not.toHaveProperty('headerBackTitle');
    }
  });

  it('titles the wallet route consistently with the screen header', () => {
    const wallet = renderRootStackScreens({
      mutedContentBackgroundColor: '#eee',
    }).find((screen) => screen.key === 'wallet/index');
    expect(
      (wallet?.props as { options: { title: string } }).options.title
    ).toBe('Wallet & Loyalty');
  });
});
