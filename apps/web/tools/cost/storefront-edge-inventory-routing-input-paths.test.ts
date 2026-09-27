import { describe, expect, it } from 'vitest';
import { STOREFRONT_EDGE_INVENTORY_POLICY } from './storefront-edge-inventory-policy';
import { STOREFRONT_EDGE_INVENTORY_ROUTING_INPUT_PATHS } from './storefront-edge-inventory-routing-input-paths';

describe('storefront edge inventory routing input paths', () => {
  it('binds checkout payment logos and legal texture pages into the inventory digest', () => {
    expect(STOREFRONT_EDGE_INVENTORY_ROUTING_INPUT_PATHS).toEqual(
      expect.arrayContaining([
        'apps/web/src/components/storefront/ogabassey/components/PaymentLogos.tsx',
        'apps/web/src/components/storefront/ogabassey/components/Footer.tsx',
        'apps/web/src/components/storefront/ogabassey/components/FooterAppPayments.tsx',
        'apps/web/src/components/storefront/ogabassey/components/utility-checkout.ts',
        'apps/web/src/config/platform.ts',
        'apps/web/src/lib/social.ts',
        'apps/web/src/components/storefront/ogabassey/pages/privacy-policy.tsx',
        'apps/web/src/components/storefront/ogabassey/pages/legal-dispute.tsx',
        'apps/web/src/components/storefront/ogabassey/pages/sustainability.tsx',
        'apps/web/src/components/storefront/ogabassey/pages/swap.tsx',
        'apps/web/src/components/analytics/google-analytics.tsx',
        'apps/web/src/components/storefront/new-template/footer.tsx',
        'apps/web/src/components/storefront/ogabassey/pages/cart-page-wrapper.tsx',
        'apps/web/src/components/storefront/ogabassey/pages/help-support.tsx',
        'apps/web/src/components/storefront/ogabassey/pages/checkout/hooks/checkout-shipping-quote-loader.ts',
        'apps/web/src/components/storefront/ogabassey/pages/checkout/handlers/complete-checkout-order.ts',
        'apps/web/src/components/storefront/ogabassey/pages/checkout/handlers/initialize-checkout-dva.ts',
        'apps/web/src/components/storefront/ogabassey/pages/checkout/handlers/initialize-checkout-gateway.ts',
        'apps/web/src/components/storefront/ogabassey/pages/checkout/handlers/open-checkout-credit-direct.ts',
        'apps/web/src/components/storefront/ogabassey/pages/checkout/handlers/open-checkout-credpal.ts',
        'apps/web/src/components/storefront/ogabassey/pages/checkout/handlers/submit-checkout-order.ts',
        'apps/web/src/components/storefront/ogabassey/pages/receipts.tsx',
        'apps/web/src/components/storefront/ogabassey/pages/receipt-claim-app-download-banner.tsx',
        'apps/web/src/components/storefront/ogabassey/pages/reviews.tsx',
        'apps/web/src/components/storefront/ogabassey/components/NegotiationModal.tsx',
        'apps/web/src/components/blog/renderer/BlogContentRenderer.tsx',
        'apps/web/src/components/ui/safe-html.tsx',
        'apps/web/src/lib/credit-direct-client.ts',
        'apps/web/src/lib/credpal.ts',
        'apps/web/src/lib/klump-sdk.ts',
        'apps/web/src/components/storefront/blocks/header.tsx',
        'apps/web/src/components/storefront/blocks/footer.tsx',
        'apps/web/src/components/storefront/templates/premium-default.tsx',
        'apps/web/src/components/storefront/product-grid.tsx',
        'apps/web/src/lib/api-client.ts',
        'apps/web/src/components/storefront/reviews-section.tsx',
        'packages/shared/src/storefront/post-purchase-actions.ts',
        'apps/web/src/components/builder/config.tsx',
        'apps/web/src/components/storefront/storefront-form.tsx',
        'apps/web/src/config/early-hints-link-header.ts',
        'apps/web/src/config/agent-discovery-link-header.ts',
        'apps/web/src/config/cdn.ts',
        'apps/web/src/components/storefront/webmcp-storefront-tools.tsx',
        'apps/web/src/components/storefront/webmcp-storefront-tools-registration.ts',
        'apps/web/src/components/storefront/webmcp-storefront-tools-builder.ts',
        'apps/web/src/components/storefront/webmcp-storefront-tools-fetch.ts',
        'apps/web/src/components/storefront/webmcp-storefront-tools-parsers.ts',
        'apps/web/src/components/storefront/webmcp-storefront-tools-types.ts',
        'apps/web/src/schemas/webmcp-storefront-tools-contract.ts',
        'apps/web/src/schemas/webmcp-storefront-tools.ts',
      ])
    );
  });

  it('matches the policy routing-input authority list exactly', () => {
    expect(STOREFRONT_EDGE_INVENTORY_POLICY.routingInputPaths).toEqual([
      ...STOREFRONT_EDGE_INVENTORY_ROUTING_INPUT_PATHS,
    ]);
  });
});
