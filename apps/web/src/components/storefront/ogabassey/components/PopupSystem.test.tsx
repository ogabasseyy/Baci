import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  it('keeps the newsletter dismissal behavior without showing the sponsored popup', async () => {
    render(<PopupSystem />);

    fireEvent.pointerDown(window);

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      vi.advanceTimersByTime(4000);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Close newsletter' }));

    act(() => {
      vi.advanceTimersByTime(10000);
    });

    expect(screen.queryByText('Sponsored')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Join Ogabassey' })
    ).not.toBeInTheDocument();
  });
});
