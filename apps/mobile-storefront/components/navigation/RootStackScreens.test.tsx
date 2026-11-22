import { describe, expect, it, jest } from '@jest/globals';
import { isValidElement } from 'react';

// expo-router's `Stack.Screen` is a register-only component (returns null
// at runtime; its purpose is to surface props to the navigator). Mock it
// as a plain function so React.createElement preserves `type` and `props`
// for introspection here.
jest.mock('expo-router', () => ({
  Stack: {
    Screen: function StackScreen() {
      return null;
    },
  },
}));

import { renderRootStackScreens } from './RootStackScreens';

describe('renderRootStackScreens', () => {
  const screens = renderRootStackScreens({
    mutedContentBackgroundColor: '#FAFAFA',
  });

  it('returns a plain array, not a Fragment', () => {
    // Expo Router's Stack inspects its direct children for Stack.Screen
    // and does NOT recurse into wrapper components or Fragments. Returning
    // a Fragment from this helper crashed with
    // `TypeError: Cannot convert Symbol to string` because mapProtectedScreen
    // tried to concat the Fragment's Symbol type. Array form is the load-
    // bearing contract.
    expect(Array.isArray(screens)).toBe(true);
    expect(screens.length).toBeGreaterThan(0);
  });

  it('returns React elements (not Fragments) for every entry', () => {
    for (const child of screens) {
      expect(isValidElement(child)).toBe(true);
      // Stack.Screen's element.type is the Stack.Screen component reference,
      // never a Symbol. Asserting `typeof type !== 'symbol'` locks out an
      // accidental `<>...</>` wrapper.
      expect(typeof child.type).not.toBe('symbol');
    }
  });

  it('assigns a unique non-empty key to every screen', () => {
    const keys = screens.map((child) => child.key);
    for (const key of keys) {
      expect(typeof key).toBe('string');
      expect(key).not.toBe('');
    }
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('assigns a unique non-empty `name` prop to every screen', () => {
    const names = screens.map((child) => {
      const props = child.props as { name?: string };
      return props.name;
    });
    for (const name of names) {
      expect(typeof name).toBe('string');
      expect(name).not.toBe('');
    }
    expect(new Set(names).size).toBe(names.length);
  });

  it('hides the native header on the (tabs) screen', () => {
    // Regression guard: the entire bug PR #1399 fixes was the (tabs) screen
    // rendering its native UINavigationBar with the route segment name as
    // the title. If a future refactor flips this back to true (or drops the
    // option), users see the same broken state.
    const tabsScreen = screens.find((child) => {
      const props = child.props as { name?: string };
      return props.name === '(tabs)';
    });
    expect(tabsScreen).toBeDefined();
    const tabsOptions = (
      tabsScreen as unknown as { props: { options: { headerShown?: boolean } } }
    ).props.options;
    expect(tabsOptions.headerShown).toBe(false);
  });

  it('disables interactive back gestures on Oxygen checkout so signature strokes cannot pop the screen', () => {
    const oxygen = screens.find((screen) => screen.key === 'oxygen-checkout');

    expect(oxygen?.props).toMatchObject({
      name: 'oxygen-checkout',
      options: { gestureEnabled: false },
    });
  });

  it('threads the muted background colour into the utilities screen', () => {
    const utilities = screens.find((child) => {
      const props = child.props as { name?: string };
      return props.name === 'utilities';
    });
    expect(utilities).toBeDefined();
    const props = (
      utilities as unknown as {
        props: {
          options: { contentStyle?: { backgroundColor?: string } };
        };
      }
    ).props;
    expect(props.options.contentStyle?.backgroundColor).toBe('#FAFAFA');
  });

  it('registers cart as a gesture-enabled root stack screen', () => {
    const cartScreen = screens.find((child) => {
      const props = child.props as { name?: string };
      return props.name === 'cart';
    });

    expect(cartScreen).toBeDefined();
    const cartOptions = (
      cartScreen as unknown as {
        props: { options: { gestureEnabled?: boolean; headerShown?: boolean } };
      }
    ).props.options;
    expect(cartOptions.headerShown).toBe(false);
    expect(cartOptions.gestureEnabled).toBe(true);
  });
});
