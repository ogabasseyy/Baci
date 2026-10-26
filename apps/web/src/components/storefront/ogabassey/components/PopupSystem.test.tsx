import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./AdUnit', () => ({
  AdUnit: () => <div data-testid="popup-ad-unit" />,
}));

import { PopupSystem } from './PopupSystem';

describe('PopupSystem', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    localStorage.clear();
  });

  it('does not show the newsletter on a passive timer alone', () => {
    render(<PopupSystem />);

    act(() => {
      vi.advanceTimersByTime(4000);
    });

    expect(
      screen.queryByRole('heading', { name: 'Join Ogabassey' })
    ).not.toBeInTheDocument();
  });

  it('shows the newsletter after user engagement and the configured delay', async () => {
    render(<PopupSystem />);

    fireEvent.pointerDown(window);

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      vi.advanceTimersByTime(3999);
    });

    expect(
      screen.queryByRole('heading', { name: 'Join Ogabassey' })
    ).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(
      screen.getByRole('heading', { name: 'Join Ogabassey' })
    ).toBeInTheDocument();
  });

  it('still queues the ad popup after the newsletter is dismissed', async () => {
    render(
      <>
        <div className="ogabassey-chat-anchor">
          <button className="ogabassey-chat-button">Assistant</button>
        </div>
        <PopupSystem />
      </>,
    );

    fireEvent.pointerDown(window);

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      vi.advanceTimersByTime(4000);
    });

    const closeNewsletter = screen.getByRole('button', { name: 'Close newsletter' });
    closeNewsletter.focus();
    fireEvent.click(closeNewsletter);
    const launcher = screen.getByRole('button', { name: 'Assistant' });
    expect(launcher).toHaveFocus();

    act(() => {
      vi.advanceTimersByTime(10000);
    });

    expect(screen.getByText('Sponsored')).toBeInTheDocument();
    expect(screen.getByTestId('popup-ad-unit')).toBeInTheDocument();

    const closeAd = screen.getByRole('button', { name: 'Close ad' });
    closeAd.focus();
    fireEvent.click(closeAd);
    expect(launcher).toHaveFocus();
  });

  it('returns focus to the launcher after a focused promotion closes', async () => {
    render(
      <>
        <div className="ogabassey-chat-anchor">
          <button className="ogabassey-chat-button">Assistant</button>
        </div>
        <PopupSystem />
      </>,
    );

    fireEvent.pointerDown(window);
    await act(async () => {
      await Promise.resolve();
    });
    act(() => vi.advanceTimersByTime(4000));

    const close = screen.getByRole('button', { name: 'Close newsletter' });
    close.focus();
    fireEvent.click(close);

    expect(screen.getByRole('button', { name: 'Assistant' })).toHaveFocus();
  });

  it('does not steal focus when a promotion closes without owning focus', async () => {
    render(
      <>
        <button>Page control</button>
        <div className="ogabassey-chat-anchor">
          <button className="ogabassey-chat-button">Assistant</button>
        </div>
        <PopupSystem />
      </>,
    );

    fireEvent.pointerDown(window);
    await act(async () => {
      await Promise.resolve();
    });
    act(() => vi.advanceTimersByTime(4000));

    const pageControl = screen.getByRole('button', { name: 'Page control' });
    pageControl.focus();
    fireEvent.click(screen.getByRole('button', { name: 'Close newsletter' }));

    expect(pageControl).toHaveFocus();
  });
});
