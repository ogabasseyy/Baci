import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./AdUnit', () => ({
  AdUnit: () => <div data-testid="popup-ad-unit" />,
}));

import { PopupSystem } from './PopupSystem';

describe('PopupSystem focus behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    localStorage.clear();
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
    fireEvent.keyDown(document, { key: 'Tab' });
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
    fireEvent.keyDown(document, { key: 'Tab' });
    close.focus();
    fireEvent.click(close);

    expect(screen.getByRole('button', { name: 'Assistant' })).toHaveFocus();
  });

  it('keeps keyboard focus in context when the newsletter form is submitted', async () => {
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

    const submit = screen.getByRole('button', { name: 'Subscribe & Save' });
    fireEvent.keyDown(document, { key: 'Tab' });
    submit.focus();
    fireEvent.submit(submit.closest('form')!);

    expect(
      screen.queryByRole('heading', { name: 'Join Ogabassey' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assistant' })).not.toHaveFocus();
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

  it('restores focus when a hidden launcher becomes available after dismissal', async () => {
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

    const anchor = document.querySelector<HTMLElement>('.ogabassey-chat-anchor');
    if (!anchor) throw new Error('Missing chat launcher anchor');
    anchor.style.display = 'none';
    const close = screen.getByRole('button', { name: 'Close newsletter' });
    fireEvent.keyDown(document, { key: 'Tab' });
    close.focus();
    fireEvent.click(close);

    expect(document.activeElement).not.toBe(
      document.querySelector('.ogabassey-chat-button'),
    );
    anchor.style.display = '';
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.querySelector('.ogabassey-chat-button')).toHaveFocus();
    act(() => vi.clearAllTimers());
  });

  it('cancels pending focus restoration after the user moves on', async () => {
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

    const anchor = document.querySelector<HTMLElement>('.ogabassey-chat-anchor');
    if (!anchor) throw new Error('Missing chat launcher anchor');
    anchor.style.display = 'none';
    const close = screen.getByRole('button', { name: 'Close newsletter' });
    fireEvent.keyDown(document, { key: 'Tab' });
    close.focus();
    fireEvent.click(close);

    const pageControl = screen.getByRole('button', { name: 'Page control' });
    fireEvent.pointerDown(pageControl);
    pageControl.focus();
    anchor.style.display = '';
    await act(async () => {
      await Promise.resolve();
    });

    expect(pageControl).toHaveFocus();
    act(() => vi.clearAllTimers());
  });

  it('expires hidden-launcher focus restoration after its bounded wait', async () => {
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

    const anchor = document.querySelector<HTMLElement>('.ogabassey-chat-anchor');
    if (!anchor) throw new Error('Missing chat launcher anchor');
    anchor.style.display = 'none';
    const close = screen.getByRole('button', { name: 'Close newsletter' });
    fireEvent.keyDown(document, { key: 'Tab' });
    close.focus();
    fireEvent.click(close);

    act(() => vi.advanceTimersByTime(10_000));
    anchor.style.display = '';
    await act(async () => {
      await Promise.resolve();
    });

    expect(document.querySelector('.ogabassey-chat-button')).not.toHaveFocus();
    act(() => vi.clearAllTimers());
  });

  it('does not force focus to chat after a pointer dismisses a promotion', async () => {
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

    const close = screen.getByRole('button', { name: 'Close newsletter' });
    close.focus();
    fireEvent.pointerDown(close);
    fireEvent.click(close);

    expect(document.activeElement).not.toBe(
      document.querySelector('.ogabassey-chat-button'),
    );
    act(() => vi.clearAllTimers());
});
});
