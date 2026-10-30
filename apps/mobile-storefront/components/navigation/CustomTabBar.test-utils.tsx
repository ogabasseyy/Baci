import { expect, jest } from '@jest/globals';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import React from 'react';

function createTabDescriptor(
  title: string
): BottomTabBarProps['descriptors'][string] {
  return {
    options: {
      title,
      tabBarIcon: () => <React.Fragment />,
      tabBarLabel: () => <React.Fragment />,
    },
    navigation:
      {} as unknown as BottomTabBarProps['descriptors'][string]['navigation'],
    route: {} as unknown as BottomTabBarProps['descriptors'][string]['route'],
    render: () => <React.Fragment />,
  };
}

function createHiddenDescriptor(
  title: string
): BottomTabBarProps['descriptors'][string] {
  return {
    options: {
      href: null,
      title,
    } as unknown as BottomTabBarProps['descriptors'][string]['options'],
    navigation:
      {} as unknown as BottomTabBarProps['descriptors'][string]['navigation'],
    route: {} as unknown as BottomTabBarProps['descriptors'][string]['route'],
    render: () => <React.Fragment />,
  };
}

function expectSavedTabPress(navigation: BottomTabBarProps['navigation']) {
  expect(navigation.emit).toHaveBeenCalledWith({
    type: 'tabPress',
    target: 'saved-key',
    canPreventDefault: true,
  });
}

function expectSavedJumpDispatch(navigation: BottomTabBarProps['navigation']) {
  expect(navigation.dispatch).toHaveBeenCalledWith({
    payload: { name: 'saved', params: {} },
    type: 'JUMP_TO',
    target: 'state-key',
  });
}

function createDefaultProps(): BottomTabBarProps {
  return {
    insets: { top: 0, bottom: 0, left: 0, right: 0 },
    state: {
      index: 0,
      routes: [
        { key: 'home-key', name: 'index', params: {} },
        { key: 'saved-key', name: 'saved', params: {} },
        { key: 'wallet-key', name: 'wallet', params: {} },
        { key: 'hidden-key', name: 'categories', params: {} },
      ],
      type: 'tab',
      routeNames: ['index', 'saved', 'wallet', 'categories'],
      history: [],
      key: 'state-key',
      stale: false,
      preloadedRouteKeys: [],
    },
    descriptors: {
      'home-key': createTabDescriptor('Home'),
      'saved-key': createTabDescriptor('Saved'),
      'wallet-key': createTabDescriptor('Wallet'),
      'hidden-key': createHiddenDescriptor('Explore'),
    },
    navigation: {
      emit: jest.fn().mockReturnValue({ defaultPrevented: false }),
      dispatch: jest.fn(),
      navigate: jest.fn(),
    } as unknown as BottomTabBarProps['navigation'],
  };
}

export const customTabBarTestUtils = {
  createHiddenDescriptor,
  createTabDescriptor,
  createDefaultProps,
  expectSavedJumpDispatch,
  expectSavedTabPress,
};
