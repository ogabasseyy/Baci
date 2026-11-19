import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ChatwootWidget,
  type ChatwootWidgetConfig,
} from '@/components/storefront/chatwoot-widget';

declare const __CHATWOOT_FIXTURE_PLATFORM_ORIGIN__: string;
declare const __CHATWOOT_FIXTURE_TOKEN_A__: string;
declare const __CHATWOOT_FIXTURE_TOKEN_B__: string;

const tenants = {
  a: {
    storeSlug: 'synthetic-tenant-a',
    websiteToken: __CHATWOOT_FIXTURE_TOKEN_A__,
  },
  b: {
    storeSlug: 'synthetic-tenant-b',
    websiteToken: __CHATWOOT_FIXTURE_TOKEN_B__,
  },
} as const;

function readTenant(): keyof typeof tenants {
  return new URLSearchParams(window.location.search).get('tenant') === 'b'
    ? 'b'
    : 'a';
}

function readRoute(): 'checkout' | 'product' {
  return window.location.pathname.split('/').includes('checkout')
    ? 'checkout'
    : 'product';
}

function navigate(tenant: keyof typeof tenants, route: 'checkout' | 'product') {
  const slug = tenants[tenant].storeSlug;
  window.history.pushState({}, '', `/${slug}/${route}?tenant=${tenant}`);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function App() {
  const [tenant, setTenant] = useState<keyof typeof tenants>(readTenant);
  const [route, setRoute] = useState<'checkout' | 'product'>(readRoute);
  const selectedTenant = tenants[tenant];
  const config: ChatwootWidgetConfig = {
    platformOrigin: __CHATWOOT_FIXTURE_PLATFORM_ORIGIN__,
    storefrontOrigin: window.location.origin,
    websiteToken: selectedTenant.websiteToken,
    storeSlug: selectedTenant.storeSlug,
  };

  return (
    <ChatwootWidget config={config}>
      <main>
        <h1>Synthetic storefront tenant {tenant.toUpperCase()}</h1>
        <output data-testid="fixture-route">{route}</output>
        <button
          type="button"
          onClick={() => {
            navigate('b', 'checkout');
            setTenant('b');
            setRoute('checkout');
          }}
        >
          Switch to tenant B
        </button>
        <button
          type="button"
          onClick={() => {
            navigate(tenant, 'product');
            setRoute('product');
          }}
        >
          Continue outside checkout
        </button>
      </main>
    </ChatwootWidget>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Missing fixture root');
createRoot(rootElement).render(<App />);
