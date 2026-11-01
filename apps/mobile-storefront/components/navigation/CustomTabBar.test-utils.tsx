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

function expectSavedTabPress(props: BottomTabBarProps) {
  expect(props.emitter.emit).toHaveBeenCalledWith({
    type: 'tabPress',
    target: 'saved-key',
    canPreventDefault: true,
  });
}

function expectSavedJumpDispatch(props: BottomTabBarProps) {
  expect(props.navigateToTab).toHaveBeenCalledWith('saved-key');
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
    },
    descriptors: {
      'home-key': createTabDescriptor('Home'),
      'saved-key': createTabDescriptor('Saved'),
      'wallet-key': createTabDescriptor('Wallet'),
      'hidden-key': createHiddenDescriptor('Explore'),
    },
    emitter: {
      emit: jest.fn().mockReturnValue({ defaultPrevented: false }),
    } as unknown as BottomTabBarProps['emitter'],
    navigateToTab: jest.fn(),
  };
}

export const customTabBarTestUtils = {
  createHiddenDescriptor,
  createTabDescriptor,
  createDefaultProps,
  expectSavedJumpDispatch,
  expectSavedTabPress,
};
