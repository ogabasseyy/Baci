import { afterEach, expect, it, vi } from 'vitest';
import { openOgabasseyUrl } from './open-ogabassey-url';

afterEach(() => {
  delete window.openai;
  vi.restoreAllMocks();
});

it('prefers the host bridge when available', () => {
  const openExternal = vi.fn();
  window.openai = { openExternal };
  const opened = vi.spyOn(window, 'open');

  expect(openOgabasseyUrl('https://ogabassey.com/cart')).toBe(true);
  expect(openExternal).toHaveBeenCalledWith({
    href: 'https://ogabassey.com/cart',
  });
  expect(opened).not.toHaveBeenCalled();
});

it('navigates a live pending tab instead of opening a new one', () => {
  window.openai = {};
  const opened = vi.spyOn(window, 'open');
  const pendingTab = { closed: false, location: { href: '' } };

  expect(
    openOgabasseyUrl(
      'https://ogabassey.com/cart',
      pendingTab as unknown as Window
    )
  ).toBe(true);
  expect(pendingTab.location.href).toBe('https://ogabassey.com/cart');
  expect(opened).not.toHaveBeenCalled();
});

it('opens a noopener tab when no bridge or pending tab exists', () => {
  window.openai = {};
  const opened = vi
    .spyOn(window, 'open')
    .mockReturnValue({} as unknown as Window);

  expect(openOgabasseyUrl('https://ogabassey.com/cart')).toBe(true);
  expect(opened).toHaveBeenCalledWith(
    'https://ogabassey.com/cart',
    '_blank',
    'noopener,noreferrer'
  );
});

it('reports blocked popups instead of throwing', () => {
  window.openai = {};
  vi.spyOn(window, 'open').mockReturnValue(null);

  expect(openOgabasseyUrl('https://ogabassey.com/cart')).toBe(false);
});

it('falls back to a fresh tab when the pending tab was closed', () => {
  window.openai = {};
  const opened = vi
    .spyOn(window, 'open')
    .mockReturnValue({} as unknown as Window);
  const pendingTab = { closed: true, location: { href: '' } };

  expect(
    openOgabasseyUrl(
      'https://ogabassey.com/cart',
      pendingTab as unknown as Window
    )
  ).toBe(true);
  expect(opened).toHaveBeenCalledWith(
    'https://ogabassey.com/cart',
    '_blank',
    'noopener,noreferrer'
  );
});
