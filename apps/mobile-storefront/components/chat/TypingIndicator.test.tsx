import { render, screen } from '@testing-library/react-native';
import { Animated } from 'react-native';
import { TypingIndicator } from '@/components/chat/TypingIndicator';

afterEach(() => {
  jest.restoreAllMocks();
});

describe('TypingIndicator', () => {
  it('keeps dot animations out of the native animated graph', () => {
    const timing = jest.spyOn(Animated, 'timing');
    const loop = jest.spyOn(Animated, 'loop').mockReturnValue({
      start: jest.fn(),
      stop: jest.fn(),
      reset: jest.fn(),
    } as unknown as Animated.CompositeAnimation);
    const rendered = render(<TypingIndicator />);

    try {
      expect(loop).toHaveBeenCalledTimes(1);
      expect(timing).toHaveBeenCalledTimes(6);
      for (const [, config] of timing.mock.calls) {
        expect(config.useNativeDriver).toBe(false);
      }
    } finally {
      rendered.unmount();
      timing.mockRestore();
      loop.mockRestore();
    }
  });

  it('renders an accessible typing indicator with three animated dots', () => {
    jest.spyOn(Animated, 'loop').mockReturnValue({
      start: jest.fn(),
      stop: jest.fn(),
      reset: jest.fn(),
    } as unknown as Animated.CompositeAnimation);

    render(<TypingIndicator />);

    expect(screen.getByLabelText('Ogabassey AI is typing')).toBeTruthy();
    expect(screen.getAllByTestId('typing-indicator-dot')).toHaveLength(3);
  });
});
