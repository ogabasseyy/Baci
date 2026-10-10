import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './index';

const products = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Phone One', slug: 'phone-one', price: 100000 },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Phone Two', slug: 'phone-two', price: 120000 },
];

afterEach(() => {
  delete window.openai;
});

describe('Ogabassey cart handoff widget', () => {
  it('shows an incomplete price search instead of an empty catalog prompt', () => {
    window.openai = { toolOutput: {
      products: [], status: 'incomplete',
      message: 'Add a category or brand to check prices accurately.',
    } };
    render(<App />);

    expect(screen.getByText('Add a category or brand to check prices accurately.')).toBeTruthy();
    expect(screen.queryByText('Ask me to search for products!')).toBeNull();
  });

  it('shows the Ogabassey logo and offers fullscreen browsing for a catalog', () => {
    const requestDisplayMode = vi.fn().mockResolvedValue(undefined);
    const setOpenInAppUrl = vi.fn();
    window.openai = { toolOutput: { products }, requestDisplayMode, setOpenInAppUrl, displayMode: 'inline' };
    render(<App />);

    expect(screen.getByRole('img', { name: 'Ogabassey logo' })).toBeTruthy();
    expect(setOpenInAppUrl).toHaveBeenCalledWith({ href: 'https://ogabassey.com' });
    fireEvent.click(screen.getByRole('button', { name: 'Expand catalog' }));
    expect(requestDisplayMode).toHaveBeenCalledWith({ mode: 'fullscreen' });
  });

  it('updates the catalog layout when the host enters fullscreen', () => {
    window.openai = {
      toolOutput: { products },
      displayMode: 'inline',
      safeArea: { insets: { top: 12, right: 14, bottom: 16, left: 18 } },
      requestDisplayMode: vi.fn().mockResolvedValue(undefined),
    };
    const { container } = render(<App />);

    expect(container.querySelector('.mode-inline')).toBeTruthy();
    expect((container.querySelector('.mode-inline') as HTMLElement).style.paddingTop).toBe('');
    expect(screen.getByRole('button', { name: 'Expand catalog' })).toBeTruthy();

    act(() => {
      if (window.openai) window.openai.displayMode = 'fullscreen';
      window.dispatchEvent(new CustomEvent('openai:set_globals', {
        detail: { globals: { displayMode: 'fullscreen' } },
      }));
    });

    expect(container.querySelector('.mode-fullscreen')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Expand catalog' })).toBeNull();
    const fullscreen = container.querySelector('.mode-fullscreen') as HTMLElement;
    expect([fullscreen.style.paddingTop, fullscreen.style.paddingRight,
      fullscreen.style.paddingBottom, fullscreen.style.paddingLeft]).toEqual([
      '12px', '14px', '16px', '18px',
    ]);

    act(() => {
      if (window.openai) window.openai.safeArea = { insets: { top: 24, right: 20, bottom: 28, left: 22 } };
      window.dispatchEvent(new CustomEvent('openai:set_globals', {
        detail: { globals: { safeArea: window.openai?.safeArea } },
      }));
    });
    expect(fullscreen.style.paddingTop).toBe('24px');
    expect(fullscreen.style.paddingBottom).toBe('28px');
  });

});
