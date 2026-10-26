import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatLauncherFixture } from './ChatLauncherFixture';

vi.mock('@/components/storefront/ogabassey/components/PopupSystem', () => ({
  PopupSystem: () => null,
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ChatLauncherFixture', () => {
  it('carries the footer constraint and dragged position into the runtime', () => {
    let queuedFrame: FrameRequestCallback | undefined;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      queuedFrame = callback;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {
      queuedFrame = undefined;
    });

    render(<ChatLauncherFixture />);
    fireEvent.click(screen.getByRole('button', { name: 'Show mobile footer' }));

    const deferredAnchor = screen.getByTestId('deferred-launcher');
    expect(deferredAnchor).toHaveAttribute('data-mobile-offset', 'default');
    const launcher = screen.getByRole('button', { name: 'Assistant launcher' });
    vi.spyOn(launcher, 'getBoundingClientRect').mockReturnValue({
      left: 200,
      top: 300,
      width: 56,
      height: 56,
      right: 256,
      bottom: 356,
      x: 200,
      y: 300,
      toJSON: () => ({}),
    } as DOMRect);

    const dispatchPointer = (type: string, x: number, y: number) => {
      const event = new MouseEvent(type, {
        bubbles: true,
        button: 0,
        clientX: x,
        clientY: y,
      });
      Object.defineProperties(event, {
        pointerId: { value: 1 },
        isPrimary: { value: true },
      });
      fireEvent(launcher, event);
    };

    act(() => {
      dispatchPointer('pointerdown', 220, 320);
      dispatchPointer('pointermove', 120, 220);
      dispatchPointer('pointerup', 120, 220);
    });
    expect(queuedFrame).toBeUndefined();

    act(() => fireEvent.click(launcher, { detail: 0 }));
    expect(screen.getByTestId('chat-window')).toBeInTheDocument();
    const runtimeAnchor = screen.getByTestId('runtime-launcher');
    expect(runtimeAnchor).toHaveAttribute('data-mobile-offset', 'default');
    fireEvent.click(screen.getByRole('button', { name: 'Close chat' }));
    expect(runtimeAnchor).toHaveStyle({
      transform: 'translate3d(100px, 200px, 0)',
    });
  });
});
