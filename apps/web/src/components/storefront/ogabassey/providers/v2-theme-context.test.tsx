import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useV2Theme, V2ThemeProvider } from './v2-theme-context';

function Probe() {
  const { theme, setTheme, toggleTheme } = useV2Theme();
  return (
    <>
      <span data-testid="theme">{theme}</span>
      <button onClick={() => setTheme('santa')}>Santa</button>
      <button onClick={toggleTheme}>Toggle</button>
    </>
  );
}

describe('V2ThemeProvider seasonal hydration defaults', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.cookie = 'storefront-theme-v2=; Max-Age=0; path=/';
  });

  it('switches to Santa after mount in December when no preference exists', async () => {
    vi.useFakeTimers({ now: new Date('2026-12-10T12:00:00Z') });
    document.cookie = '';

    render(
      <V2ThemeProvider>
        <Probe />
      </V2ThemeProvider>
    );

    expect(screen.getByTestId('theme')).toHaveTextContent('santa');
    expect(document.cookie).toContain('storefront-theme-v2=santa');
  });

  it('clears a stale Santa cookie and switches to standard after mount in January', async () => {
    vi.useFakeTimers({ now: new Date('2027-01-10T12:00:00Z') });
    document.cookie = 'storefront-theme-v2=santa;path=/';

    render(
      <V2ThemeProvider>
        <Probe />
      </V2ThemeProvider>
    );

    expect(screen.getByTestId('theme')).toHaveTextContent('standard');
    expect(document.cookie).toContain('storefront-theme-v2=standard');
  });

  it('rejects Santa initialTheme outside December', () => {
    vi.useFakeTimers({ now: new Date('2027-01-10T12:00:00Z') });
    document.cookie = 'storefront-theme-v2=santa;path=/';
    render(
      <V2ThemeProvider initialTheme="santa">
        <Probe />
      </V2ThemeProvider>
    );
    expect(screen.getByTestId('theme')).toHaveTextContent('standard');
    expect(document.cookie).toContain('storefront-theme-v2=standard');
  });

  it('rejects explicit Santa and toggle activation outside December', async () => {
    vi.useFakeTimers({ now: new Date('2027-01-10T12:00:00Z') });
    document.cookie = '';
    const { getByRole } = render(
      <V2ThemeProvider>
        <Probe />
      </V2ThemeProvider>
    );
    getByRole('button', { name: 'Santa' }).click();
    expect(screen.getByTestId('theme')).toHaveTextContent('standard');
    getByRole('button', { name: 'Toggle' }).click();
    expect(screen.getByTestId('theme')).toHaveTextContent('standard');
  });

  it('leaves Santa mode when an open tab crosses into January', () => {
    vi.useFakeTimers({ now: new Date('2026-12-31T23:59:00') });
    document.cookie = '';
    render(
      <V2ThemeProvider>
        <Probe />
      </V2ThemeProvider>
    );
    expect(screen.getByTestId('theme')).toHaveTextContent('santa');

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.getByTestId('theme')).toHaveTextContent('standard');
    expect(document.cookie).toContain('storefront-theme-v2=standard');
  });

  it('chunks early-December reset delays below the browser timeout limit', () => {
    vi.useFakeTimers({ now: new Date('2026-12-01T00:00:00Z') });
    document.cookie = '';
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    render(
      <V2ThemeProvider>
        <Probe />
      </V2ThemeProvider>
    );
    expect(setTimeoutSpy.mock.calls[0]?.[1]).toBeLessThanOrEqual(2_147_000_000);
    act(() => vi.advanceTimersByTime(2_147_000_000));
    expect(
      setTimeoutSpy.mock.calls.every(
        ([, delay]) => Number(delay) <= 2_147_000_000
      )
    ).toBe(true);
    act(() => vi.advanceTimersToNextTimer());
    expect(screen.getByTestId('theme')).toHaveTextContent('standard');
    setTimeoutSpy.mockRestore();
  });
});
