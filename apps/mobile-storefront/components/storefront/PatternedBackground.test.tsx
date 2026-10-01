import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { BRAND } from '@/constants/Colors';
import { PatternedBackground } from './PatternedBackground';

const mockGadgetPattern = jest.fn(
  (_props: {
    color: string;
    colorScheme: 'light' | 'dark';
    height: number;
    opacity: number;
  }) => <Text>GadgetPattern</Text>
);

jest.mock('./GadgetPattern', () => ({
  GadgetPattern: (props: {
    color: string;
    colorScheme: 'light' | 'dark';
    height: number;
    opacity: number;
  }) => mockGadgetPattern(props),
}));

describe('PatternedBackground', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('bounds the gradient to the measured 812-point screen instead of 1500 points', () => {
    render(<PatternedBackground backgroundColor="#FAFAFA" isDark={false} />);

    fireEvent(screen.getByTestId('patterned-background-clip'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 375, height: 812 } },
    });

    expect(mockGadgetPattern).toHaveBeenLastCalledWith(
      expect.objectContaining({ height: 812 })
    );
  });

  it('resizes the gradient when the container changes orientation', () => {
    render(<PatternedBackground backgroundColor="#111111" isDark />);
    const clip = screen.getByTestId('patterned-background-clip');
    fireEvent(clip, 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 375, height: 812 } },
    });

    fireEvent(clip, 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 812, height: 375 } },
    });

    expect(mockGadgetPattern).toHaveBeenLastCalledWith(
      expect.objectContaining({ height: 375, opacity: 0.04, color: '#ffffff' })
    );
  });

  it('uses the light brand pattern over the supplied background', () => {
    render(<PatternedBackground backgroundColor="#FAFAFA" isDark={false} />);

    expect(screen.getByTestId('patterned-background-base')).toHaveStyle({
      backgroundColor: '#FAFAFA',
    });
    expect(mockGadgetPattern).toHaveBeenCalledWith({
      color: BRAND.primary,
      colorScheme: 'light',
      height: 0,
      opacity: 0.07,
    });
  });

  it('uses the low-opacity white pattern in dark mode', () => {
    render(<PatternedBackground backgroundColor="#111111" isDark={true} />);

    expect(mockGadgetPattern).toHaveBeenCalledWith({
      color: '#ffffff',
      colorScheme: 'dark',
      height: 0,
      opacity: 0.04,
    });
  });
});
