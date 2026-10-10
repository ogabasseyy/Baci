import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { resetOgabasseyScrollVisibilityStoreForTests } from '../ogabassey/scroll-visibility-store';
import { SearchToolbarReveal } from './search-toolbar-reveal';

function scroll(y: number) {
  Object.defineProperty(window, 'scrollY', { configurable: true, value: y });
  act(() => window.dispatchEvent(new Event('scroll')));
}
afterEach(() => {
  vi.unstubAllGlobals();
  resetOgabasseyScrollVisibilityStoreForTests();
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
});
it('hides on downward scrolling and reveals on reverse without unmounting controls', () => {
  const view = render(
    <SearchToolbarReveal pinned={false}>
      <button type="button">Filters</button>
    </SearchToolbarReveal>
  );
  scroll(160);
  expect(screen.getByTestId('search-toolbar-reveal')).toHaveAttribute(
    'aria-hidden',
    'true'
  );
  expect(screen.getByTestId('search-toolbar-reveal')).toHaveAttribute('inert');
  scroll(120);
  expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument();
  fireEvent.focus(screen.getByRole('button', { name: 'Filters' }));
  scroll(220);
  expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument();
  view.rerender(
    <SearchToolbarReveal pinned>
      <button type="button">Filters</button>
    </SearchToolbarReveal>
  );
  expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument();
});

it('keeps desktop filters visible during result scrolling', () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  render(
    <SearchToolbarReveal pinned={false}>
      <button type="button">Filters</button>
    </SearchToolbarReveal>
  );
  scroll(200);
  expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument();
});
