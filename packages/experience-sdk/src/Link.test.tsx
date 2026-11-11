import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Link } from './Link';
import { createMockCommerce } from './mock-commerce';
import { CommerceProvider } from './provider';

it('same-document and modified gestures request host navigation without window.open', () => {
  const commerce = createMockCommerce({
    catalog: { revision: '1', products: [] },
    capabilities: [],
    route: {
      epoch: 1,
      routeId: 'home',
      canonicalPath: '/',
      params: {},
      publicDataRevision: '1',
    },
  });
  const go = vi.spyOn(commerce.navigation, 'go');
  const open = vi.spyOn(commerce.navigation, 'open');
  const popup = vi.spyOn(window, 'open');
  render(
    <CommerceProvider commerce={commerce}>
      <Link path="/products/device">Product</Link>
    </CommerceProvider>
  );
  const link = screen.getByRole('link');
  fireEvent.click(link);
  fireEvent.click(link, { ctrlKey: true });
  expect(go).toHaveBeenCalledWith('/products/device');
  expect(open).toHaveBeenCalledWith('/products/device');
  expect(popup).not.toHaveBeenCalled();
  popup.mockRestore();
});
