export function buildClientHydrationEntrySource(
  entryPath: string,
  assetsMap: Readonly<Record<string, string>> = {}
): string {
  return `
import { CommerceProvider, createCommerceClient } from '@baci/experience-sdk';
import { createElement } from 'react';
import { hydrateRoot } from 'react-dom/client';
import StorefrontApp from ${JSON.stringify(`./${entryPath}`)};

const ASSETS_MAP = ${JSON.stringify(assetsMap)};
const isSafeInternalPath = (p) => typeof p === 'string' && p.startsWith('/') && !p.startsWith('//');
const rootElement = document.getElementById('root');
const stateScript = document.getElementById('__BACI_STOREFRONT_STATE__');
if (rootElement && stateScript?.textContent) {
  const initialProps = JSON.parse(stateScript.textContent);
  const commerce = createCommerceClient(async (method, args) => {
    if (method === 'navigation.go' && isSafeInternalPath(args.path)) {
      window.location.assign(args.path);
      return { status: 'ok', value: { path: args.path, params: {} } };
    }
    if (method === 'navigation.open' && isSafeInternalPath(args.path)) {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'baci:navigation.open', path: args.path }, 'https://usebaci.com');
        return { status: 'ok', value: null };
      }
      const win = window.open(args.path, '_blank', 'noopener,noreferrer');
      return win
        ? { status: 'ok', value: null }
        : { status: 'error', code: 'UNAVAILABLE', message: 'New browsing context unavailable' };
    }
    if (method === 'checkout.open') {
      window.location.assign(\`https://\${initialProps.merchantSlug}.usebaci.com/cart\`);
      return { status: 'ok', value: null };
    }
    return { status: 'error', code: 'UNAVAILABLE', message: 'Commerce transport requires active storefront session' };
  });
  hydrateRoot(
    rootElement,
    createElement(CommerceProvider, { commerce, assets: ASSETS_MAP }, createElement(StorefrontApp, initialProps))
  );
}
`;
}
