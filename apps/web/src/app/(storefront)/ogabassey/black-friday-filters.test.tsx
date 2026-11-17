import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  EMPTY_AVAILABLE_FILTER_OPTIONS,
  INITIAL_CATEGORY_FILTER_STATE,
} from '@/components/storefront/ogabassey/pages/category-page-derivations';
import { BlackFridayFilters } from './black-friday-filters';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

vi.mock('next/dynamic', async () => {
  const { Suspense, lazy } = await import('react');
  return {
    default: <Props extends object>(
      loader: () => Promise<React.ComponentType<Props>>
    ) => {
      const Component = lazy(async () => ({ default: await loader() }));
      return (props: Props) => (
        <Suspense fallback={null}>
          <Component {...props} />
        </Suspense>
      );
    },
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockClear();
});

function renderFilters(desktop: boolean) {
  vi.stubGlobal('matchMedia', () => ({
    matches: desktop,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));

  render(
    <BlackFridayFilters
      pathPrefix="/ogabassey"
      count={2}
      selection={{
        availableOptions: {
          ...EMPTY_AVAILABLE_FILTER_OPTIONS,
          brand: ['Apple'],
        },
        filters: INITIAL_CATEGORY_FILTER_STATE,
        sort: '',
      }}
    />
  );
}

it('opens and dismisses the mobile drawer, then applies a facet and sort', async () => {
  renderFilters(false);
  const trigger = screen.getByRole('button', { name: /filter and sort/i });
  fireEvent.click(trigger);
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Close filters' })
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(push).not.toHaveBeenCalled();

  fireEvent.click(trigger);
  const drawer = within(await screen.findByRole('dialog'));
  fireEvent.click(drawer.getByRole('checkbox', { name: 'Apple' }));
  fireEvent.change(drawer.getByRole('combobox', { name: 'Sort by' }), {
    target: { value: 'price-desc' },
  });
  fireEvent.click(drawer.getByRole('button', { name: 'Apply filters' }));
  expect(push).toHaveBeenCalledWith(
    '/ogabassey/black-friday?brand=Apple&sort=price-desc#black-friday-offers'
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('clears desktop facets and sort and applies the unfiltered URL', async () => {
  renderFilters(true);
  const sidebar = within(
    screen.getByRole('complementary', { name: 'Filter Black Friday offers' })
  );
  const apple = await sidebar.findByRole('checkbox', { name: 'Apple' });
  const sort = sidebar.getByRole('combobox', { name: 'Sort by' });
  fireEvent.click(apple);
  fireEvent.change(sort, { target: { value: 'price-asc' } });
  expect(apple).toBeChecked();
  expect(sort).toHaveValue('price-asc');

  fireEvent.click(sidebar.getByRole('button', { name: 'Clear All' }));
  expect(apple).not.toBeChecked();
  expect(sort).toHaveValue('');
  fireEvent.click(sidebar.getByRole('button', { name: 'Apply filters' }));
  expect(push).toHaveBeenCalledWith(
    '/ogabassey/black-friday#black-friday-offers'
  );
});
