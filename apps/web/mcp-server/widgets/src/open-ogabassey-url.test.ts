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
      pendingTab as unknown as Window,
    ),
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
    'noopener,noreferrer',
  );
});

it('does not report a failed popup from the null result required by noopener', () => {
  window.openai = {};
  vi.spyOn(window, 'open').mockReturnValue(null);

  expect(openOgabasseyUrl('https://ogabassey.com/cart')).toBe(true);
});

it.each([
  null,
  { closed: true, location: { href: '' } },
])('reports an unavailable reserved tab without an async popup retry', (tab) => {
  const opened = vi.spyOn(window, 'open');
  expect(
    openOgabasseyUrl('https://ogabassey.com/cart', tab as Window | null),
  ).toBe(false);
  expect(opened).not.toHaveBeenCalled();
});

it('reports a browser exception as a failed navigation request', () => {
  window.openai = {};
  vi.spyOn(window, 'open').mockImplementation(() => {
    throw new Error('navigation rejected');
  });
  expect(openOgabasseyUrl('https://ogabassey.com/cart')).toBe(false);
});
