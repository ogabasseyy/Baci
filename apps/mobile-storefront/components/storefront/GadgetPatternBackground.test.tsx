import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { BRAND } from '@/constants/Colors';
import { GadgetPattern } from './GadgetPattern';
import {
  DARK_COLOR,
  DARK_OPACITY,
  GadgetPatternBackground,
  LIGHT_COLOR,
  LIGHT_OPACITY,
  PATTERN_HEIGHT,
} from './GadgetPatternBackground';

// Mock the Svg-heavy GadgetPattern to keep the unit test pure and stable
jest.mock('./GadgetPattern', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return {
    GadgetPattern: jest.fn((props: Record<string, unknown>) =>
      React.createElement(View, { testID: 'gadget-pattern', ...props })
    ),
  };
});

const getMockedGadgetPattern = () => jest.mocked(GadgetPattern);

describe('GadgetPatternBackground', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps absolute-fill wrappers non-interactive and applies the base backgroundColor', () => {
    const bgColor = '#ff0000';
    const { toJSON } = render(
      <GadgetPatternBackground colorScheme="light" backgroundColor={bgColor} />
    );

    // Verify component mounts and renders base views
    expect(screen.getByTestId('gadget-pattern')).toBeOnTheScreen();

    // Verify component renders completely
    const json = toJSON();
    expect(json).not.toBeNull();

    const layers = Array.isArray(json) ? json : json ? [json] : [];
    expect(layers).toHaveLength(2);
    expect(StyleSheet.flatten(layers[0]?.props.style)).toMatchObject({
      backgroundColor: bgColor,
      pointerEvents: 'none',
    });
    expect(StyleSheet.flatten(layers[1]?.props.style)).toMatchObject({
      overflow: 'hidden',
      pointerEvents: 'none',
    });
  });

  it('applies correct opacity and color for light and dark colorScheme modes', () => {
    // 1. Test Light color scheme
    render(
      <GadgetPatternBackground colorScheme="light" backgroundColor="#ffffff" />
    );
    const lightProps = getMockedGadgetPattern().mock.lastCall?.[0];
    expect(lightProps).toBeDefined();
    expect(lightProps).toMatchObject({
      opacity: LIGHT_OPACITY,
      color: LIGHT_COLOR,
    });

    // 2. Test Dark color scheme
    render(
      <GadgetPatternBackground colorScheme="dark" backgroundColor="#000000" />
    );
    const darkProps = getMockedGadgetPattern().mock.lastCall?.[0];
    expect(darkProps).toBeDefined();
    expect(darkProps).toMatchObject({
      opacity: DARK_OPACITY,
      color: BRAND.primary,
    });
    expect(DARK_COLOR).toBe(BRAND.primary);
  });

  it('forwards custom height values and defaults to PATTERN_HEIGHT when height is omitted', () => {
    // 1. Omitted height should default to PATTERN_HEIGHT (1500)
    render(
      <GadgetPatternBackground colorScheme="light" backgroundColor="#ffffff" />
    );
    const defaultProps = getMockedGadgetPattern().mock.lastCall?.[0];
    expect(defaultProps).toBeDefined();
    expect(defaultProps).toMatchObject({
      height: PATTERN_HEIGHT,
    });

    // 2. Custom height should be forwarded
    const customHeight = 450;
    render(
      <GadgetPatternBackground
        colorScheme="light"
        backgroundColor="#ffffff"
        height={customHeight}
      />
    );
    const customProps = getMockedGadgetPattern().mock.lastCall?.[0];
    expect(customProps).toBeDefined();
    expect(customProps).toMatchObject({
      height: customHeight,
    });
  });

  it('allows a screen to make the shared pattern more visible', () => {
    render(
      <GadgetPatternBackground
        colorScheme="dark"
        backgroundColor="#000000"
        opacity={0.1}
      />
    );

    expect(getMockedGadgetPattern().mock.lastCall?.[0]).toMatchObject({
      color: BRAND.primary,
      opacity: 0.1,
    });
  });
});
