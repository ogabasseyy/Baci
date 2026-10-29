import { act, fireEvent, render, screen } from '@testing-library/react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { vi } from 'vitest';
import { useChatLauncherDrag } from './use-chat-launcher-drag';

function Harness({
  open = false,
  hasOverflow = false,
  hidden = false,
  initialPosition,
  onRender = () => {},
  onOpen = () => {},
  onOverflowMount,
  onSuppressClick,
  constraintKey = 'screen',
}: {
  open?: boolean;
  hasOverflow?: boolean;
  hidden?: boolean;
  initialPosition?: { x: number; y: number };
  onRender?: () => void;
  onOpen?: () => void;
  onOverflowMount?: (bubble: HTMLDivElement) => void;
  onSuppressClick?: (
    suppress: (event: ReactMouseEvent<HTMLButtonElement>) => boolean,
  ) => void;
  constraintKey?: string;
}) {
  const drag = useChatLauncherDrag(
    initialPosition,
    open,
    hasOverflow,
    hidden,
    constraintKey,
  );
  onSuppressClick?.(drag.suppressClick);
  onRender();
  return (
    <div
      ref={drag.anchorRef}
      style={
        {
          ...drag.anchorStyle,
          '--ogabassey-chat-safe-area-bottom': '34px',
        } as React.CSSProperties
      }
      data-testid="anchor"
      data-mobile-offset={constraintKey}
    >
      <div className="relative group">
        {hasOverflow && (
          <div
            ref={(bubble) => {
              if (bubble) onOverflowMount?.(bubble);
            }}
            data-chat-launcher-overflow
            data-testid="launcher-bubble"
          />
        )}
        <button
          type="button"
          {...drag.buttonProps}
          onClick={(event) => {
            if (!drag.suppressClick(event)) onOpen();
          }}
        >
          Chat
        </button>
      </div>
    </div>
  );
}

export function setup(options: { initialPosition?: { x: number; y: number } } = {}) {
  let frame: FrameRequestCallback | undefined;
  let notifyResizeObserver: ResizeObserverCallback | undefined;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        notifyResizeObserver = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frame = callback;
    return 1;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {
    frame = undefined;
  });
  const onRender = vi.fn();
  const onOpen = vi.fn();
  let suppressClick:
    | ((event: ReactMouseEvent<HTMLButtonElement>) => boolean)
    | undefined;
  const getComputedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    if (element instanceof HTMLDivElement && element.style.position === 'fixed') {
      return { height: '34px' } as CSSStyleDeclaration;
    }
    if (pseudo === '::before') return { height: '34px' } as CSSStyleDeclaration;
    if (pseudo === '::after') {
      return {
        height: element.getAttribute('data-mobile-offset') === 'default' ? '92px' : '16px',
      } as CSSStyleDeclaration;
    }
    return getComputedStyle(element);
  });
  const view = render(
    <Harness
      initialPosition={options.initialPosition}
      onRender={onRender}
      onOpen={onOpen}
      onSuppressClick={(suppress) => {
        suppressClick = suppress;
      }}
    />,
  );
  const button = screen.getByRole('button', { name: 'Chat' });
  const measure = vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
    left: 200,
    top: 300,
    width: 56,
    height: 56,
    right: 256,
    bottom: 356,
    x: 200,
    y: 300,
    toJSON: () => ({}),
  });
  const pointer = (
    type: string,
    x: number,
    y: number,
    pointerId = 1,
    pointerType = 'mouse',
  ) =>
    fireEvent(
      button,
      Object.assign(
        new MouseEvent(type, {
          bubbles: true,
          clientX: x,
          clientY: y,
          button: 0,
        }),
        { pointerId, pointerType, isPrimary: true },
      ),
    );
  const click = (
    x: number,
    y: number,
    detail = 1,
    pointerId: number | null = 1,
  ) =>
    fireEvent(
      button,
      Object.assign(
        new MouseEvent('click', {
          bubbles: true,
          detail,
          clientX: x,
          clientY: y,
        }),
        ...(pointerId === null ? [] : [{ pointerId }]),
      ),
    );
  return {
    ...view,
    button,
    click,
    trustedClick: (x: number, y: number, pointerId?: number) => {
      const event = {
        detail: 1,
        clientX: x,
        clientY: y,
        nativeEvent: {
          ...(pointerId === undefined ? {} : { pointerId }),
          ...(pointerId === 0 ? { pointerType: 'touch' } : {}),
          isTrusted: true,
        },
      };
      if (!suppressClick?.(
        event as unknown as ReactMouseEvent<HTMLButtonElement>,
      ))
        onOpen();
    },
    measure,
    onOpen,
    onRender,
    pointer,
    flush: () => act(() => frame?.(0)),
    notifyResizeObserver: () =>
      act(() => notifyResizeObserver?.([], {} as ResizeObserver)),
  };
}

export default { Harness, setup };
