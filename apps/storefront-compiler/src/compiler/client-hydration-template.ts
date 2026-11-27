export function buildClientHydrationEntrySource(entryPath: string): string {
  return `
import { createElement } from 'react';
import { hydrateRoot } from 'react-dom/client';
import StorefrontApp from ${JSON.stringify(`./${entryPath}`)};

const rootElement = document.getElementById('root');
const stateScript = document.getElementById('__BACI_STOREFRONT_STATE__');
if (rootElement && stateScript?.textContent) {
  const initialProps = JSON.parse(stateScript.textContent);
  hydrateRoot(rootElement, createElement(StorefrontApp, initialProps));
}
`;
}
