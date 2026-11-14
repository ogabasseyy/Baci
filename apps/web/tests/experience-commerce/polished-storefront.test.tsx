import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const require = createRequire(`${process.cwd()}/package.json`);
const cart = { lines: [{ quantity: 1 }], total: 250, currency: 'NGN' };
const commerce = {
  cart: { readPublic: vi.fn(), add: vi.fn() },
  checkout: { prepare: vi.fn(), open: vi.fn() },
  navigation: { go: vi.fn() },
};
const source = readFileSync(
  `${process.cwd()}/tests/experience-commerce/polished-storefront.tsx.txt`,
  'utf8'
).replace("import './style.css';", '');
const code = execFileSync(
  process.execPath,
  [
    '-e',
    "process.stdout.write(require('esbuild').transformSync(require('fs').readFileSync(0,'utf8'),{loader:'tsx',format:'cjs',jsx:'automatic'}).code)",
  ],
  { input: source, encoding: 'utf8' }
);
const module = {
  exports: {} as { default?: React.ComponentType<Record<string, unknown>> },
};
runInNewContext(code, {
  module,
  exports: module.exports,
  require: (name: string) =>
    name === '@baci/experience-sdk'
      ? { useCommerce: () => commerce, useAssetUrl: () => '/synthetic.png' }
      : require(name),
  Intl,
});
const Store = module.exports.default;
if (!Store) throw new Error('Missing authored storefront component');
const props = {
  route: { routeId: 'home' },
  catalog: {
    products: [
      {
        id: 'synthetic-device',
        name: 'Synthetic QA Device',
        slug: 'synthetic-device',
        price: 250,
        currency: 'NGN',
        available: true,
        canonicalPath: '/products/synthetic-device',
      },
    ],
  },
};
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it('uses Baci cart totals and opens prepared checkout without an order operation', async () => {
  commerce.cart.add.mockResolvedValue({ status: 'ok', value: cart });
  commerce.checkout.prepare.mockResolvedValue({
    status: 'ok',
    value: { ready: true },
  });
  commerce.checkout.open.mockResolvedValue({ status: 'ok' });
  render(<Store {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Add to bag +' }));
  await screen.findByRole('dialog', { name: 'Shopping bag' });
  await screen.findByText('Added to your bag');
  expect(commerce.cart.add).toHaveBeenCalledWith({
    productId: 'synthetic-device',
    quantity: 1,
  });
  expect(screen.getAllByText('₦250').length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: 'Review checkout ↗' }));
  await waitFor(() => expect(commerce.checkout.open).toHaveBeenCalledOnce());
});
it('keeps illustration colour independent of commerce variants and surfaces cart errors', async () => {
  commerce.cart.add.mockRejectedValue(new Error('synthetic failure'));
  render(<Store {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Preview Clay' }));
  expect(
    screen
      .getByRole('button', { name: 'Preview Clay' })
      .getAttribute('aria-pressed')
  ).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Add to bag +' }));
  // The status is shown when the bag is opened, including recoverable errors.
  commerce.cart.readPublic.mockResolvedValue({ status: 'ok', value: cart });
  fireEvent.click(screen.getByRole('button', { name: 'Bag 0' }));
  await screen.findByText('Could not add this item. Please try again.');
  expect(commerce.checkout.open).not.toHaveBeenCalled();
});

it('routes catalog products through the declared custom product view', () => {
  render(<Store {...props} />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Meet your next everyday ↗' })
  );
  expect(commerce.navigation.go).toHaveBeenCalledWith(
    '/products/synthetic-device'
  );
});
