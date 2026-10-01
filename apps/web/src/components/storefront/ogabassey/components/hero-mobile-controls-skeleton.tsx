import {
  HERO_MOBILE_CONTROL_TRACK_CLASSES,
  HERO_MOBILE_CONTROLS_ROW_CLASSES,
  HERO_MOBILE_PLAY_TOGGLE_SLOT_CLASSES,
} from './hero-mobile-geometry';

/**
 * Non-interactive skeleton of the mobile carousel's controls row (dot tracks
 * + play-toggle slot). Shares the row's geometry tokens, so it always
 * measures exactly what the live multi-slide row measures (~52px).
 *
 * Rendered visibly by the streaming reserve fallback and invisibly by the
 * resolved zero/single-slide heroes: the reserve fallback always bets on a
 * multi-slide hero, so the degenerate states must keep the same slot (empty
 * but sized) or the fallback-to-content swap shifts everything below it up
 * by the missing row — the CLS the reservation exists to prevent.
 */
export function HeroMobileControlsSkeleton({
  invisible = false,
}: {
  /** Reserve the geometry without painting (resolved degenerate states). */
  invisible?: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      className={`${HERO_MOBILE_CONTROLS_ROW_CLASSES}${invisible ? ' invisible' : ''}`}
      data-ogabassey-mobile-controls-skeleton={invisible ? 'reserved' : 'true'}
    >
      <div className="flex flex-1 items-center gap-1.5">
        {[0, 1, 2].map((index) => (
          <div className={HERO_MOBILE_CONTROL_TRACK_CLASSES} key={index} />
        ))}
      </div>
      <div className={HERO_MOBILE_PLAY_TOGGLE_SLOT_CLASSES} />
    </div>
  );
}
