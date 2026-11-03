import { render } from '@testing-library/react-native';
import type { RefObject } from 'react';
import type { ScrollViewInstance, ViewInstance } from 'react-native';
import {
  STEPPER_STACK_HEIGHT,
  useIntentScrollIntoView,
} from './use-intent-scroll-into-view';

const SAFE_AREA_TOP = 59;
const VIEWPORT_TOP = SAFE_AREA_TOP + STEPPER_STACK_HEIGHT;

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({
    top: 59,
    bottom: 0,
    left: 0,
    right: 0,
  }),
}));

// A card whose measureInWindow synchronously reports the given window Y.
function cardAt(cardTop: number): RefObject<ViewInstance | null> {
  return {
    current: {
      measureInWindow: (
        cb: (x: number, y: number, w: number, h: number) => void
      ) => cb(0, cardTop, 320, 80),
    },
  } as unknown as RefObject<ViewInstance | null>;
}

function scrollWith(scrollTo: jest.Mock): RefObject<ScrollViewInstance | null> {
  return {
    current: { scrollTo },
  } as unknown as RefObject<ScrollViewInstance | null>;
}

type HookParams = Parameters<typeof useIntentScrollIntoView>[0];

function Host(props: HookParams) {
  useIntentScrollIntoView(props);
  return null;
}

describe('useIntentScrollIntoView', () => {
  beforeEach(() => {
    jest.spyOn(global, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0 as unknown as number;
    });
    jest
      .spyOn(global, 'cancelAnimationFrame')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('scrolls the selected card down to just under the stepper when a collapse pushed it above', () => {
    const scrollTo = jest.fn();
    const cardTop = 20; // pushed near the very top of the window
    render(
      <Host
        expandedKey="installments:credit_direct"
        cardRef={cardAt(cardTop)}
        scrollRef={scrollWith(scrollTo)}
        scrollOffsetRef={{ current: 400 }}
      />
    );

    const expectedY = 400 - (VIEWPORT_TOP - cardTop);
    expect(scrollTo).toHaveBeenCalledWith({ y: expectedY, animated: true });
  });

  it('does nothing when the card already sits below the stepper', () => {
    const scrollTo = jest.fn();
    render(
      <Host
        expandedKey="full:paystack"
        cardRef={cardAt(VIEWPORT_TOP + 40)}
        scrollRef={scrollWith(scrollTo)}
        scrollOffsetRef={{ current: 400 }}
      />
    );

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('clamps the target offset to zero so it never overscrolls past the top', () => {
    const scrollTo = jest.fn();
    render(
      <Host
        expandedKey="full:paystack"
        cardRef={cardAt(20)}
        scrollRef={scrollWith(scrollTo)}
        scrollOffsetRef={{ current: 50 }}
      />
    );

    // 50 - (VIEWPORT_TOP - 20) is negative -> clamped to 0
    expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: true });
  });

  it('no-ops when no scroll ref is provided (VTU / tests)', () => {
    const scrollTo = jest.fn();
    render(
      <Host
        expandedKey="full:paystack"
        cardRef={cardAt(20)}
        scrollRef={undefined}
        scrollOffsetRef={{ current: 0 }}
      />
    );

    expect(scrollTo).not.toHaveBeenCalled();
  });
});
