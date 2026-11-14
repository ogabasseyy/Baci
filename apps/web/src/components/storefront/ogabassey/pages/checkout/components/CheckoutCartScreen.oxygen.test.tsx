import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CheckoutCartScreen } from './CheckoutCartScreen';

vi.mock('@/hooks/cart', () => ({ useCart: () => ({ sharedCartEnabled:true, syncStatus:'synced', importStatus:'done', isHydrated:true, sharedCartRef:{cartId:'cart',version:1}, importWarnings:['import_capacity_exceeded'] }) }));
vi.mock('@/components/storefront/cart/cart-import-conflicts', () => ({ CartImportConflicts: () => <p>Resolve cart capacity</p> }));
vi.mock('./CheckoutScreen', () => ({CheckoutScreen: () => <p>Oxygen recovery</p>}));
const model = {page:{onReturnToCart:vi.fn()}} as never;

it('lets a server-verified matching Oxygen recovery through unrelated cart capacity', () => {
  render(<CheckoutCartScreen model={model} order={null} requestedId={null} verifiedOxygenOrderId="owned" requestedOxygenId="owned" />);
  expect(screen.getByText('Oxygen recovery')).toBeVisible();
  expect(screen.queryByText('Resolve cart capacity')).toBeNull();
});

it('does not bypass capacity for an unverified or mismatched Oxygen id', () => {
  const view=render(<CheckoutCartScreen model={model} order={null} requestedId={null} requestedOxygenId="unverified" />);
  expect(screen.queryByText('Oxygen recovery')).toBeNull();
  expect(screen.getByText('Resolve cart capacity')).toBeVisible();
  view.rerender(<CheckoutCartScreen model={model} order={null} requestedId={null} verifiedOxygenOrderId="owned" requestedOxygenId="other" />);
  expect(screen.queryByText('Oxygen recovery')).toBeNull();
});
