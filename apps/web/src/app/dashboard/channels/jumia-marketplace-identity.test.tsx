import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { JumiaMarketplaceIdentity } from './jumia-marketplace-identity';

const integration = {
  id: 'integration-1',
  shop_id: 'shop-1',
  shop_name: 'Shop',
  country_code: 'NG',
  is_active: true,
  last_sync_at: null,
  sync_error: null,
};

describe('JumiaMarketplaceIdentity', () => {
  it('renders a distinct business-client identity', () => {
    render(
      <JumiaMarketplaceIdentity
        integration={{ ...integration, marketplace_key: 'jumia-ng-main' }}
      />
    );
    expect(screen.getByText(/jumia-ng-main/)).toBeInTheDocument();
  });

  it('hides the shared OAuth sentinel', () => {
    const { container } = render(
      <JumiaMarketplaceIdentity
        integration={{ ...integration, marketplace_key: 'oauth' }}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
