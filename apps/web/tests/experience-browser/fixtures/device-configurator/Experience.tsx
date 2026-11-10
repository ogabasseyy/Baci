import type { PublicCatalog, RouteState } from '@baci/shared/experience';
import { useEffect, useRef, useState } from 'react';
import { useQualificationCommerce } from '../qualification-commerce';
import './style.css';
export default function Experience({
  route,
  catalog,
}: {
  route: RouteState;
  catalog: PublicCatalog;
}) {
  const [variant, setVariant] = useState('silver');
  const [zoomed, setZoomed] = useState(false);
  const [drag, setDrag] = useState(0);
  const [ready, setReady] = useState(false);
  const art = useRef<HTMLDivElement>(null);
  const commerce = useQualificationCommerce();
  useEffect(() => {
    setReady(true);
    art.current?.setAttribute('data-ref-ready', 'true');
  }, []);
  return (
    <main data-ready={ready}>
      <nav aria-label="Synthetic routes">
        {[
          ['/', 'Home'],
          ['/collections/devices', 'Collection'],
          ['/products/device', 'Product'],
          ['/journal/design', 'Editorial'],
        ].map(([path, label]) => (
          <button
            type="button"
            key={path}
            onClick={() => commerce.navigate(path)}
          >
            {label}
          </button>
        ))}
      </nav>
      <p>SYNTHETIC DEVICE LAB · {route.routeId}</p>
      <h1>{catalog.products[0]?.name ?? 'Synthetic device'}</h1>
      <div
        ref={art}
        role="img"
        aria-label="Synthetic device illustration"
        className={`device ${zoomed ? 'zoom' : ''}`}
        style={{
          transform: `translateX(${drag}px) scale(${zoomed ? 1.15 : 1})`,
        }}
        onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
        onPointerMove={(e) => {
          if (e.buttons === 1)
            setDrag(Math.max(-40, Math.min(40, e.clientX - 180)));
        }}
      />
      <button
        type="button"
        aria-pressed={zoomed}
        onClick={() => setZoomed(!zoomed)}
      >
        Zoom illustration
      </button>
      <label>
        Finish
        <select value={variant} onChange={(e) => setVariant(e.target.value)}>
          <option value="silver">Silver</option>
          <option value="ink">Ink</option>
        </select>
      </label>
      <p>Selected finish: {variant}</p>
      <button type="button" onClick={commerce.add}>
        Add synthetic item
      </button>
      <p role="status">Mock bag: {commerce.count}</p>
      <p>Illustration only. No customer data, orders or payments.</p>
    </main>
  );
}
