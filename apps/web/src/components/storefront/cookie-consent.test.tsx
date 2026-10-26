import { act, fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CookieConsent, useCookieConsent } from './cookie-consent';

// Mock dependencies required by module imports for export tests
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: () => ({ basePath: '' }),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe('CookieConsent', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('exports CookieConsent component', () => {
    expect(CookieConsent).toBeDefined();
    expect(typeof CookieConsent).toBe('function');
  });

  it('exports useCookieConsent hook', () => {
    expect(useCookieConsent).toBeDefined();
    expect(typeof useCookieConsent).toBe('function');
  });

  it('keeps the mobile consent dialog inside the viewport', () => {
    render(<CookieConsent />);
    act(() => vi.advanceTimersByTime(1000));

    const dialog = screen.getByRole('dialog', { name: 'Cookie consent' });
    expect(dialog).toHaveClass('w-auto', 'overflow-y-auto', 'z-[100]');
    expect(dialog).not.toHaveClass('w-full');
  });

  it('links the banner policy CTA to the canonical privacy route', () => {
    render(<CookieConsent />);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(
      screen.getByRole('link', { name: /read our policy/i })
    ).toHaveAttribute('href', '/privacy');
  });

  it('moves focus into consent when it covers the chat and restores focus on dismiss', () => {
    const { container } = render(
      <>
        <div className="ogabassey-chat-anchor">
          <button className="ogabassey-chat-button" type="button">
            Assistant launcher
          </button>
        </div>
        <CookieConsent />
      </>
    );
    const launcher = screen.getByRole('button', { name: 'Assistant launcher' });
    launcher.focus();

    act(() => vi.advanceTimersByTime(1000));

    const customizeButton = screen.getByRole('button', { name: 'Customize' });
    expect(customizeButton).toHaveFocus();
    expect(container.querySelector('.storefront-cookie-consent')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Accept All' }));
    act(() => vi.advanceTimersByTime(200));

    expect(launcher).toHaveFocus();
  });

  it('does not steal focus back after the shopper moves outside consent', () => {
    render(
      <>
        <div className="ogabassey-chat-anchor">
          <button className="ogabassey-chat-button" type="button">
            Assistant launcher
          </button>
        </div>
        <button type="button">Outside control</button>
        <CookieConsent />
      </>
    );
    screen.getByRole('button', { name: 'Assistant launcher' }).focus();
    act(() => vi.advanceTimersByTime(1000));
    const outside = screen.getByRole('button', { name: 'Outside control' });
    outside.focus();

    fireEvent.click(screen.getByRole('button', { name: 'Accept All' }));
    act(() => vi.advanceTimersByTime(200));

    expect(outside).toHaveFocus();
  });

  it('does not restore chat focus after consent loses focus to the document body', () => {
    render(
      <div className="ogabassey-chat-anchor">
        <button className="ogabassey-chat-button" type="button">
          Assistant launcher
        </button>
        <CookieConsent />
      </div>
    );
    const launcher = screen.getByRole('button', { name: 'Assistant launcher' });
    launcher.focus();
    act(() => vi.advanceTimersByTime(1000));
    const accept = screen.getByRole('button', { name: 'Accept All' });
    accept.focus();
    accept.blur();
    expect(document.activeElement).toBe(document.body);

    fireEvent.click(accept);
    act(() => vi.advanceTimersByTime(200));

    expect(launcher).not.toHaveFocus();
  });

  it('does not move focus out of an open chat conversation', () => {
    render(
      <div className="ogabassey-chat-anchor">
        <div className="ogabassey-chat-window">
          <input aria-label="Chat message" />
          <button className="ogabassey-chat-button" type="button">
            Close chat
          </button>
        </div>
        <CookieConsent />
      </div>
    );
    const input = screen.getByRole('textbox', { name: 'Chat message' });
    input.focus();

    act(() => vi.advanceTimersByTime(1000));

    expect(input).toHaveFocus();
  });

  it('remains a non-modal banner when focus starts on another page control', () => {
    render(
      <>
        <button type="button">Outside control</button>
        <CookieConsent />
      </>
    );
    const outside = screen.getByRole('button', { name: 'Outside control' });
    outside.focus();

    act(() => vi.advanceTimersByTime(1000));

    expect(
      screen.getByRole('dialog', { name: 'Cookie consent' })
    ).toHaveAttribute('aria-modal', 'false');
    expect(outside).toHaveFocus();
  });

  it('keeps focus on the chat toggle when consent appears during an open chat', () => {
    render(
      <div className="ogabassey-chat-anchor">
        <div className="ogabassey-chat-window">
          <input aria-label="Chat message" />
        </div>
        <button className="ogabassey-chat-button" type="button">
          Close chat
        </button>
        <CookieConsent />
      </div>
    );
    const toggle = screen.getByRole('button', { name: 'Close chat' });
    toggle.focus();

    act(() => vi.advanceTimersByTime(1000));

    expect(toggle).toHaveFocus();
  });

  it('moves focus from the bubble dismiss control into consent and restores it', () => {
    render(
      <div className="ogabassey-chat-anchor">
        <button type="button" className="ogabassey-chat-button">
          Assistant launcher
        </button>
        <button type="button" aria-label="Dismiss chat message">
          Dismiss
        </button>
        <CookieConsent />
      </div>
    );
    const dismiss = screen.getByRole('button', {
      name: 'Dismiss chat message',
    });
    dismiss.focus();

    act(() => vi.advanceTimersByTime(1000));

    expect(screen.getByRole('button', { name: 'Customize' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Accept All' }));
    act(() => vi.advanceTimersByTime(200));
    expect(dismiss).toHaveFocus();
  });
});
