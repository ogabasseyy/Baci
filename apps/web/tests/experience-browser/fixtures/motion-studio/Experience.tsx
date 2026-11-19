import type { PublicCatalog, RouteState } from '@baci/shared/experience';
import { motion } from 'framer-motion';
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
  const [active, setActive] = useState(false);
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
      <h1>Motion, authored in code.</h1>
      <p>
        {route.routeId} · {catalog.products[0]?.name}
      </p>
      <motion.div
        drag
        dragConstraints={{ left: -30, right: 30, top: -30, bottom: 30 }}
        animate={{ rotate: active ? 45 : 0 }}
        className="motion-tile"
        aria-label="Draggable animated tile"
        role="img"
      />
      <button type="button" onClick={() => setActive(!active)}>
        Animate tile
      </button>
      <button type="button" onClick={commerce.add}>
        Add synthetic item
      </button>
      <p role="status">Mock bag: {commerce.count}</p>
    </main>
  );
}
