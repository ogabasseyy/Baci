import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SystemHealthMissingIndexes } from './system-health-missing-indexes';

describe('SystemHealthMissingIndexes', () => {
  it('renders nothing when no missing indexes are reported', () => {
    const { container } = render(<SystemHealthMissingIndexes indexes={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists each missing index without collapsing the warning', () => {
    render(
      <SystemHealthMissingIndexes
        indexes={['orders_merchant_id_idx', 'products_active_idx']}
      />
    );
    expect(screen.getByText('Missing Indexes')).toBeVisible();
    expect(screen.getByText('orders_merchant_id_idx')).toBeVisible();
    expect(screen.getByText('products_active_idx')).toBeVisible();
  });
});
