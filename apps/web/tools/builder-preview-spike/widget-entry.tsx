import { createRoot } from 'react-dom/client';
import { PortableHomeView } from '../../src/components/storefront/portable/portable-home';

// Real widget data arrives from the authorized tool snapshot, never a hardcoded merchant.
export function mountPortablePreview(
  element: HTMLElement,
  snapshot: { config: unknown; merchant: unknown; catalog: unknown }
) {
  const root = createRoot(element);
  root.render(<PortableHomeView {...snapshot} inert />);
  return () => root.unmount();
}
