'use client';

import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useV2Theme } from '../providers/v2-theme-context';
import { SNOW_CSS, SNOW_LAYERS } from './snow-styles';
import { useSnowDismissal } from './use-snow-dismissal';

/**
 * December snow for the Santa theme: compositor-only CSS animation with no
 * per-frame JavaScript, and a button so shoppers can stop it (WCAG 2.2.2).
 */
export function SnowEffect() {
  const { theme } = useV2Theme();
  const reducedMotion = useReducedMotion();
  const { stopped, stop } = useSnowDismissal();

  if (theme !== 'santa' || reducedMotion || stopped) return null;

  return (
    <>
      <style>{SNOW_CSS}</style>
      <div aria-hidden="true" className="oga-snow" data-testid="snow-effect">
        {SNOW_LAYERS.map((layer, index) => (
          <div
            key={layer.tile}
            className={`oga-snow-layer oga-snow-layer-${index}`}
          />
        ))}
        <div className="oga-snow-lights" />
      </div>
      <button type="button" className="oga-snow-stop" onClick={stop}>
        Stop snow
      </button>
    </>
  );
}
