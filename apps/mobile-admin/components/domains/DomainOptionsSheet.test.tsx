import '@testing-library/jest-dom/vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { Suspense, startTransition } from 'react';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

let DomainOptionsSheet: typeof import('./DomainOptionsSheet').default;
beforeAll(async () => {
  DomainOptionsSheet = (await import('./DomainOptionsSheet')).default;
});

import { baseDomain, mocks } from './domain-options-sheet.test-support';
import type { Domain, DomainAction } from './domain-types';

function sheet(
  visible: boolean,
  onClose: () => void,
  onAction: (action: DomainAction, domain: Domain) => void
) {
  return (
    <DomainOptionsSheet
      visible={visible}
      domain={baseDomain}
      onClose={onClose}
      onAction={onAction}
    />
  );
}

describe('DomainOptionsSheet', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    mocks.onExit = null;
    mocks.onDismiss = null;
    mocks.platform.OS = 'android';
    vi.useRealTimers();
  });

  it('waits for the actual exit completion even after the nominal duration', () => {
    const onAction = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(sheet(true, onClose, onAction));
    fireEvent.click(screen.getByRole('button', { name: 'Visit Site' }));
    rerender(sheet(false, onClose, onAction));
    vi.advanceTimersByTime(1000);
    expect(onAction).not.toHaveBeenCalled();
    expect(mocks.onExit).not.toBeNull();
    act(() => mocks.onExit?.(true));
    act(() => vi.runAllTimers());
    expect(onAction).toHaveBeenCalledWith('visit', baseDomain);
  });

  it('dispatches once if the post-close frame is dropped', () => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frame = callback;
      return 7;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const onAction = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(sheet(true, onClose, onAction));
    fireEvent.click(screen.getByRole('button', { name: 'Visit Site' }));
    rerender(sheet(false, onClose, onAction));
    act(() => mocks.onExit?.(true));
    act(() => vi.advanceTimersByTime(499));
    expect(onAction).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onAction).toHaveBeenCalledTimes(1);
    act(() => frame?.(0));
    expect(onAction).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('on iOS waits for native modal dismissal after animation completion', () => {
    mocks.platform.OS = 'ios';
    const onAction = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(sheet(true, onClose, onAction));
    fireEvent.click(screen.getByRole('button', { name: 'Visit Site' }));
    rerender(sheet(false, onClose, onAction));
    act(() => mocks.onExit?.(true));
    act(() => vi.runAllTimers());
    expect(onAction).not.toHaveBeenCalled();
    act(() => mocks.onDismiss?.());
    expect(onAction).toHaveBeenCalledWith('visit', baseDomain);
  });

  it('does not dispatch if the exit animation is cancelled', () => {
    const onAction = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(sheet(true, onClose, onAction));
    fireEvent.click(screen.getByRole('button', { name: 'Visit Site' }));
    rerender(sheet(false, onClose, onAction));
    act(() => mocks.onExit?.(false));
    act(() => vi.runAllTimers());
    expect(onAction).not.toHaveBeenCalled();
  });

  it('does not strand an action after a suspended close render is discarded', () => {
    const onAction = vi.fn();
    const onClose = vi.fn();
    const never = new Promise<never>(() => {});
    const Suspend = () => {
      throw never;
    };
    const { rerender } = render(
      <Suspense fallback={null}>{sheet(true, onClose, onAction)}</Suspense>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Visit Site' }));
    const committedExit = mocks.onExit;
    act(() => {
      startTransition(() =>
        rerender(
          <Suspense fallback={null}>
            {sheet(false, onClose, onAction)}
            <Suspend />
          </Suspense>
        )
      );
    });
    rerender(
      <Suspense fallback={null}>{sheet(false, onClose, onAction)}</Suspense>
    );
    act(() => committedExit?.(true));
    act(() => vi.runAllTimers());
    expect(onAction).toHaveBeenCalledWith('visit', baseDomain);
  });

  it('uses the latest callback when the parent rerenders during closing', () => {
    const first = vi.fn();
    const latest = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(
      <DomainOptionsSheet
        visible
        domain={baseDomain}
        onClose={onClose}
        onAction={first}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Visit Site' }));
    rerender(
      <DomainOptionsSheet
        visible={false}
        domain={baseDomain}
        onClose={onClose}
        onAction={first}
      />
    );
    rerender(
      <DomainOptionsSheet
        visible={false}
        domain={baseDomain}
        onClose={onClose}
        onAction={latest}
      />
    );
    act(() => mocks.onExit?.(true));
    act(() => vi.runAllTimers());
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledWith('visit', baseDomain);
  });

  it('ignores a pending action after unmount even if its callback runs late', () => {
    const onAction = vi.fn();
    const onClose = vi.fn();
    const { rerender, unmount } = render(sheet(true, onClose, onAction));
    fireEvent.click(screen.getByRole('button', { name: 'Visit Site' }));
    rerender(sheet(false, onClose, onAction));
    const late = mocks.onExit;
    unmount();
    act(() => late?.(true));
    act(() => vi.runAllTimers());
    expect(onAction).not.toHaveBeenCalled();
  });

  it('keeps only the last selected action when multiple actions are tapped before close applies', () => {
    const onAction = vi.fn();
    const onClose = vi.fn();

    const { rerender } = render(sheet(true, onClose, onAction));

    fireEvent.click(screen.getByRole('button', { name: 'Visit Site' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Domain' }));
    expect(onClose).toHaveBeenCalledTimes(2);

    rerender(sheet(false, onClose, onAction));

    act(() => mocks.onExit?.(true));
    act(() => vi.runAllTimers());
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith('delete', baseDomain);
  });

  it('ignores a prior exit callback after reopening and closing again', () => {
    const onAction = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(sheet(true, onClose, onAction));
    fireEvent.click(screen.getByRole('button', { name: 'Visit Site' }));
    const firstExit = mocks.onExit;
    rerender(sheet(false, onClose, onAction));
    rerender(sheet(true, onClose, onAction));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Domain' }));
    const secondExit = mocks.onExit;
    rerender(sheet(false, onClose, onAction));
    act(() => firstExit?.(true));
    act(() => vi.runAllTimers());
    expect(onAction).not.toHaveBeenCalled();
    act(() => secondExit?.(true));
    act(() => vi.runAllTimers());
    expect(onAction).toHaveBeenCalledWith('delete', baseDomain);
  });

  it('clears stale pending actions when the sheet is reopened', () => {
    const onAction = vi.fn();
    const onClose = vi.fn();

    const { rerender } = render(sheet(true, onClose, onAction));

    fireEvent.click(screen.getByRole('button', { name: 'Visit Site' }));

    rerender(sheet(false, onClose, onAction));

    rerender(sheet(true, onClose, onAction));

    rerender(sheet(false, onClose, onAction));

    act(() => mocks.onExit?.(true));
    act(() => vi.runAllTimers());
    expect(onAction).not.toHaveBeenCalled();
  });
});
