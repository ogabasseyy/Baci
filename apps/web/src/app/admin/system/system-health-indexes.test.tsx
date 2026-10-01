import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SystemHealthIndexes } from './system-health-indexes';

describe('SystemHealthIndexes', () => {
  it('renders each recommendation with a readable priority', () => {
    render(
      <SystemHealthIndexes
        loading={false}
        indexRecommendations={[
          {
            table_name: 'orders',
            index_name: 'orders_merchant_id_idx',
            reason: 'Merchant lookups',
            priority: 'high',
          },
          {
            table_name: 'products',
            index_name: 'products_active_idx',
            reason: 'Catalog reads',
            priority: 'medium',
          },
          {
            table_name: 'events',
            index_name: 'events_type_idx',
            reason: 'Audit filters',
            priority: 'low',
          },
        ]}
      />
    );

    expect(screen.getByText('orders_merchant_id_idx')).toBeVisible();
    expect(screen.getByText('High')).toBeVisible();
    expect(screen.getByText('Medium')).toBeVisible();
    expect(screen.getByText('Low')).toBeVisible();
  });

  it('does not imply recommendations while the request is loading', () => {
    render(<SystemHealthIndexes loading indexRecommendations={[]} />);
    expect(
      screen.queryByText('No index recommendations returned')
    ).not.toBeInTheDocument();
    expect(
      document.querySelector('[class*="animate-pulse"]')
    ).toBeInTheDocument();
  });

  it('explains when a completed check has no recommendations', () => {
    render(<SystemHealthIndexes loading={false} indexRecommendations={[]} />);
    expect(screen.getByText('No index recommendations returned')).toBeVisible();
  });
});
