import { act, fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeferredGoogleStoreWidget } from './deferred-google-store-widget';

let mockPathname = '/';
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

type TestWidgetModule = {
  GoogleStoreWidget: ({
    merchantCustomDomain,
    skipActivationDelay,
  }: {
    merchantCustomDomain?: string | null;
    skipActivationDelay?: boolean;
  }) => React.ReactElement;
};

function createTestWidgetModule(): TestWidgetModule {
  return {
    GoogleStoreWidget: ({ merchantCustomDomain, skipActivationDelay }) => (
      <div>
        Widget {merchantCustomDomain} {String(skipActivationDelay)}
      </div>
    ),
  };
}

describe('DeferredGoogleStoreWidget', () => {
  beforeEach(() => {
    mockPathname = '/';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('waits for the defer window before importing the widget module', async () => {
    const loadWidgetModule = vi
      .fn()
      .mockResolvedValue(createTestWidgetModule());

    render(
      <DeferredGoogleStoreWidget
        merchantCustomDomain="ogabassey.com"
        enabled
        loadWidgetModule={loadWidgetModule}
      />
    );

    expect(screen.queryByText(/Widget ogabassey.com/)).not.toBeInTheDocument();
    expect(loadWidgetModule).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(19999);
    });

    expect(screen.queryByText(/Widget ogabassey.com/)).not.toBeInTheDocument();
    expect(loadWidgetModule).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });

    expect(loadWidgetModule).toHaveBeenCalledOnce();
    expect(screen.getByText('Widget ogabassey.com true')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(20000);
    });

    expect(loadWidgetModule).toHaveBeenCalledOnce();
  });

  it('imports the widget immediately after interaction', async () => {
    const loadWidgetModule = vi
      .fn()
      .mockResolvedValue(createTestWidgetModule());

    render(
      <DeferredGoogleStoreWidget
        merchantCustomDomain="ogabassey.com"
        enabled
        loadWidgetModule={loadWidgetModule}
      />
    );

    fireEvent.pointerDown(window);

    await act(async () => {
      await Promise.resolve();
    });

    expect(loadWidgetModule).toHaveBeenCalledOnce();
    expect(screen.getByText('Widget ogabassey.com true')).toBeInTheDocument();
  });

  it('does not treat scroll as an early widget activation signal', async () => {
    const loadWidgetModule = vi
      .fn()
      .mockResolvedValue(createTestWidgetModule());

    render(
      <DeferredGoogleStoreWidget
        merchantCustomDomain="ogabassey.com"
        enabled
        loadWidgetModule={loadWidgetModule}
      />
    );

    fireEvent.scroll(window);

    await act(async () => {
      await Promise.resolve();
    });

    expect(loadWidgetModule).not.toHaveBeenCalled();
    expect(screen.queryByText(/Widget ogabassey.com/)).not.toBeInTheDocument();
  });

  it('does not start a second widget import while the first import is pending', async () => {
    let resolveWidgetModule: ((module: TestWidgetModule) => void) | undefined;
    const loadWidgetModule = vi.fn(
      () =>
        new Promise<TestWidgetModule>((resolve) => {
          resolveWidgetModule = resolve;
        })
    );

    render(
      <DeferredGoogleStoreWidget
        merchantCustomDomain="ogabassey.com"
        enabled
        loadWidgetModule={loadWidgetModule}
      />
    );

    fireEvent.pointerDown(window);
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      vi.advanceTimersByTime(20000);
    });
    fireEvent.pointerDown(window);

    expect(loadWidgetModule).toHaveBeenCalledOnce();

    await act(async () => {
      resolveWidgetModule?.(createTestWidgetModule());
      await Promise.resolve();
    });

    expect(screen.getByText('Widget ogabassey.com true')).toBeInTheDocument();
  });

  it('allows a later interaction to retry after a failed widget import', async () => {
    const loadWidgetModule = vi
      .fn()
      .mockRejectedValueOnce(new Error('Chunk failed'))
      .mockResolvedValueOnce(createTestWidgetModule());

    render(
      <DeferredGoogleStoreWidget
        merchantCustomDomain="ogabassey.com"
        enabled
        loadWidgetModule={loadWidgetModule}
      />
    );

    await act(async () => {
      fireEvent.pointerDown(window);
      await Promise.resolve();
    });

    expect(loadWidgetModule).toHaveBeenCalledOnce();
    expect(screen.queryByText(/Widget ogabassey.com/)).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.keyDown(window);
      await Promise.resolve();
    });

    expect(loadWidgetModule).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Widget ogabassey.com true')).toBeInTheDocument();
  });

  it('treats synchronous loader failures as retryable import failures', async () => {
    const loadWidgetModule = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('Chunk failed before promise creation');
      })
      .mockResolvedValueOnce(createTestWidgetModule());

    render(
      <DeferredGoogleStoreWidget
        merchantCustomDomain="ogabassey.com"
        enabled
        loadWidgetModule={loadWidgetModule}
      />
    );

    await act(async () => {
      fireEvent.pointerDown(window);
      await Promise.resolve();
    });

    expect(loadWidgetModule).toHaveBeenCalledOnce();
    expect(screen.queryByText(/Widget ogabassey.com/)).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(20000);
      await Promise.resolve();
    });

    expect(loadWidgetModule).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Widget ogabassey.com true')).toBeInTheDocument();
  });

  it('keeps interaction retry triggers after all fire during a pending failed import', async () => {
    let rejectWidgetModule: ((error: Error) => void) | undefined;
    const loadWidgetModule = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<TestWidgetModule>((_resolve, reject) => {
            rejectWidgetModule = reject;
          })
      )
      .mockResolvedValueOnce(createTestWidgetModule());

    render(
      <DeferredGoogleStoreWidget
        merchantCustomDomain="ogabassey.com"
        enabled
        loadWidgetModule={loadWidgetModule}
      />
    );

    fireEvent.pointerDown(window);
    fireEvent.pointerDown(window);
    fireEvent.keyDown(window);
    await act(async () => {
      await Promise.resolve();
    });

    expect(loadWidgetModule).toHaveBeenCalledOnce();

    await act(async () => {
      rejectWidgetModule?.(new Error('Chunk failed'));
      await Promise.resolve();
    });

    expect(screen.queryByText(/Widget ogabassey.com/)).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.pointerDown(window);
      await Promise.resolve();
    });

    expect(loadWidgetModule).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Widget ogabassey.com true')).toBeInTheDocument();
  });

  it('re-arms the defer timeout after a failed widget import', async () => {
    const loadWidgetModule = vi
      .fn()
      .mockRejectedValueOnce(new Error('Chunk failed'))
      .mockResolvedValueOnce(createTestWidgetModule());

    render(
      <DeferredGoogleStoreWidget
        merchantCustomDomain="ogabassey.com"
        enabled
        loadWidgetModule={loadWidgetModule}
      />
    );

    await act(async () => {
      fireEvent.pointerDown(window);
      await Promise.resolve();
    });

    expect(loadWidgetModule).toHaveBeenCalledOnce();

    await act(async () => {
      vi.advanceTimersByTime(20000);
      await Promise.resolve();
    });

    expect(loadWidgetModule).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Widget ogabassey.com true')).toBeInTheDocument();
  });

  it('stops automatic defer retries but allows later user-triggered retry', async () => {
    const loadWidgetModule = vi
      .fn()
      .mockRejectedValueOnce(new Error('Chunk failed'))
      .mockRejectedValueOnce(new Error('Chunk failed'))
      .mockRejectedValueOnce(new Error('Chunk failed'))
      .mockResolvedValueOnce(createTestWidgetModule());

    render(
      <DeferredGoogleStoreWidget
        merchantCustomDomain="ogabassey.com"
        enabled
        loadWidgetModule={loadWidgetModule}
      />
    );

    await act(async () => {
      fireEvent.pointerDown(window);
      await Promise.resolve();
    });

    expect(loadWidgetModule).toHaveBeenCalledOnce();

    // Two timer advances consume the automatic retries; the third confirms the retry limit holds.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await act(async () => {
        vi.advanceTimersByTime(20000);
        await Promise.resolve();
      });
    }

    expect(loadWidgetModule).toHaveBeenCalledTimes(3);
    expect(screen.queryByText(/Widget ogabassey.com/)).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.keyDown(window);
      await Promise.resolve();
    });

    expect(loadWidgetModule).toHaveBeenCalledTimes(4);
    expect(screen.getByText('Widget ogabassey.com true')).toBeInTheDocument();
  });

  it('stays disabled when the widget is turned off', async () => {
    const loadWidgetModule = vi.fn();

    render(
      <DeferredGoogleStoreWidget
        merchantCustomDomain="ogabassey.com"
        enabled={false}
        loadWidgetModule={loadWidgetModule}
      />
    );

    await act(async () => {
      vi.runOnlyPendingTimers();
      await Promise.resolve();
    });

    expect(loadWidgetModule).not.toHaveBeenCalled();
    expect(screen.queryByText(/Widget ogabassey.com/)).not.toBeInTheDocument();
  });

  it('stays suppressed on payment/checkout routes so it never covers the consent UI', async () => {
    mockPathname = '/checkout';
    const loadWidgetModule = vi
      .fn()
      .mockResolvedValue(createTestWidgetModule());

    render(
      <DeferredGoogleStoreWidget
        merchantCustomDomain="ogabassey.com"
        enabled
        loadWidgetModule={loadWidgetModule}
      />
    );

    fireEvent.pointerDown(window);
    await act(async () => {
      vi.advanceTimersByTime(21000);
      await Promise.resolve();
    });

    expect(loadWidgetModule).not.toHaveBeenCalled();
    expect(screen.queryByText(/Widget ogabassey.com/)).not.toBeInTheDocument();
  });

  it('hides a badge iframe injected after landing on a suppressed route', async () => {
    mockPathname = '/checkout';
    render(
      <DeferredGoogleStoreWidget merchantCustomDomain="ogabassey.com" enabled />
    );

    // The external script appends the fixed badge iframe AFTER the suppression
    // effect already ran — the observer must still hide it.
    const frame = document.createElement('iframe');
    frame.id = 'merchantwidgetiframe';
    await act(async () => {
      document.body.appendChild(frame);
      await Promise.resolve();
    });

    expect(frame.style.display).toBe('none');

    frame.remove();
  });
});
