import '@testing-library/jest-dom/vitest';
import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShipmentFlowSheetPresence } from './ShipmentFlowSheetPresence';

const mocks = vi.hoisted(() => ({
  onExit: null as ((finished: boolean) => void) | null,
  onShow: null as (() => void) | null,
}));

vi.mock('react-native-reanimated', () => {
  const MockAnimatedView = ({
    children,
    entering,
  }: {
    children?: ReactNode;
    entering?: { name: string };
  }) => <div data-entering={entering?.name}>{children}</div>;
  const transition = (name: string) => ({
    duration: () => ({
      name,
      withCallback: (callback: (finished: boolean) => void) => {
        mocks.onExit = callback;
        return { name };
      },
    }),
  });

  return {
    default: { View: MockAnimatedView },
    FadeIn: transition('FadeIn'),
    FadeOut: transition('FadeOut'),
    runOnJS: (callback: () => void) => callback,
    SlideInDown: transition('SlideInDown'),
    SlideOutDown: transition('SlideOutDown'),
  };
});

vi.mock('react-native', () => ({
  Modal: ({
    animationType,
    children,
    onShow,
    visible,
  }: {
    animationType?: string;
    children?: ReactNode;
    onShow?: () => void;
    visible?: boolean;
  }) => {
    mocks.onShow = onShow ?? null;
    return visible ? (
      <section data-animation={animationType} data-testid="ship-modal">
        {children}
      </section>
    ) : null;
  },
  StyleSheet: {
    absoluteFill: {},
    create: (styles: Record<string, unknown>) => styles,
    hairlineWidth: 1,
  },
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

function renderSheet(visible: boolean) {
  return render(
    <ShipmentFlowSheetPresence
      accessory={<span>Scanner</span>}
      onRequestClose={vi.fn()}
      visible={visible}
    >
      <p>Fulfillment Details</p>
    </ShipmentFlowSheetPresence>
  );
}

describe('ShipmentFlowSheetPresence', () => {
  beforeEach(() => {
    mocks.onExit = null;
    mocks.onShow = null;
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports when the sheet is on screen so the opener can close underneath', () => {
    const onShow = vi.fn();
    render(
      <ShipmentFlowSheetPresence
        onRequestClose={vi.fn()}
        onShow={onShow}
        visible
      >
        <p>Fulfillment Details</p>
      </ShipmentFlowSheetPresence>
    );

    act(() => mocks.onShow?.());

    expect(onShow).toHaveBeenCalled();
  });

  it('still reports the sheet as shown when the modal event never arrives', () => {
    vi.useFakeTimers();
    const onShow = vi.fn();
    render(
      <ShipmentFlowSheetPresence
        onRequestClose={vi.fn()}
        onShow={onShow}
        visible
      >
        <p>Fulfillment Details</p>
      </ShipmentFlowSheetPresence>
    );

    expect(onShow).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(onShow).toHaveBeenCalled();
  });

  it('fades the backdrop in instead of sliding it up with the sheet', () => {
    renderSheet(true);

    expect(screen.getByTestId('ship-modal')).toHaveAttribute(
      'data-animation',
      'none'
    );
    expect(document.querySelector('[data-entering="FadeIn"]')).not.toBeNull();
    expect(
      screen.getByText('Fulfillment Details').closest('[data-entering]')
    ).toHaveAttribute('data-entering', 'SlideInDown');
  });

  it('keeps the modal open while the sheet slides out after closing', () => {
    const { rerender } = renderSheet(true);

    rerender(
      <ShipmentFlowSheetPresence onRequestClose={vi.fn()} visible={false}>
        <p>Fulfillment Details</p>
      </ShipmentFlowSheetPresence>
    );

    expect(screen.getByTestId('ship-modal')).toBeInTheDocument();
    expect(screen.queryByText('Fulfillment Details')).not.toBeInTheDocument();
  });

  it('removes the modal once the slide-out animation finishes', () => {
    const { rerender } = renderSheet(true);
    rerender(
      <ShipmentFlowSheetPresence onRequestClose={vi.fn()} visible={false}>
        <p>Fulfillment Details</p>
      </ShipmentFlowSheetPresence>
    );

    act(() => mocks.onExit?.(true));

    expect(screen.queryByTestId('ship-modal')).not.toBeInTheDocument();
  });

  it('renders nothing when the sheet has not been opened', () => {
    renderSheet(false);

    expect(screen.queryByTestId('ship-modal')).not.toBeInTheDocument();
  });
});
