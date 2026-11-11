import type { PublicCatalog, RouteState } from '@baci/shared/experience';
import { useState } from 'react';
import { useQualificationCommerce } from '../qualification-commerce';
import './style.css';
export default function Experience({
  route,
  catalog,
}: {
  route: RouteState;
  catalog: PublicCatalog;
}) {
  const [open, setOpen] = useState(false);
  const commerce = useQualificationCommerce();
  return (
    <main>
      <nav aria-label="Synthetic routes">
        {[
          '/',
          '/collections/studio',
          '/products/device',
          '/journal/design',
        ].map((path) => (
          <button
            type="button"
            key={path}
            onClick={() => commerce.navigate(path)}
          >
            {path}
          </button>
        ))}
      </nav>
      <p>THE SYNTHETIC STUDIO · {route.routeId}</p>
      <h1>Objects with room to breathe.</h1>
      <p>Editorial fixture. No real fashion inventory is implied.</p>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        Explore details
      </button>
      {open && (
        <section>
          <h2>{catalog.products[0]?.name}</h2>
          <p>A synthetic catalog fixture for layout qualification.</p>
          <button type="button" onClick={commerce.add}>
            Add synthetic item
          </button>
        </section>
      )}
      <p role="status">Mock bag: {commerce.count}</p>
    </main>
  );
}
