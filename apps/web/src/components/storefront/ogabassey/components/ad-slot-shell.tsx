import type { CSSProperties, ReactNode, Ref } from 'react';

export interface AdSlotShellProps {
  /** Human-readable placement name shown in the placeholder. */
  name: string;
  /** Desktop creative dimensions (applied at >= 768px). */
  width: number;
  height: number;
  /** Mobile creative dimensions (applied at < 768px). */
  mobileWidth?: number;
  mobileHeight?: number;
  /** Render the "Ad Space" placeholder pattern (hide once a real ad paints). */
  showPlaceholder?: boolean;
  /** Hide the whole shell from the a11y tree (used for the reserved fallback). */
  ariaHidden?: boolean;
  /** Extra classes forwarded to the outer wrapper. */
  outerClassName?: string;
  /** Ref to the fixed-size slot box (used for viewport activation). */
  boxRef?: Ref<HTMLDivElement>;
  /** The live ad slot element (e.g. the GPT container). */
  children?: ReactNode;
}

/**
 * Single source of truth for an ad slot's reserved box.
 *
 * The box height is LOCKED to the exact creative height per breakpoint via the
 * `.ogabassey-ad-slot` rule (mobile CSS vars + a >=768px media query) combined
 * with `overflow-hidden`, so a filled ad can never grow the box. Rendering the
 * SAME shell for the deferred fallback and the loaded `AdUnit` keeps the swap
 * shift-free: on load, only the inner content changes (placeholder -> ad
 * iframe), never the box dimensions. This is what keeps ad placements CLS-safe.
 */
export function AdSlotShell({
  name,
  width,
  height,
  mobileWidth,
  mobileHeight,
  showPlaceholder = true,
  ariaHidden = false,
  outerClassName = '',
  boxRef,
  children,
}: AdSlotShellProps) {
  const effectiveMobileWidth = mobileWidth ?? width;
  const effectiveMobileHeight = mobileHeight ?? height;
  const slotStyle = {
    '--ad-slot-w': `${effectiveMobileWidth}px`,
    '--ad-slot-h': `${effectiveMobileHeight}px`,
    '--ad-slot-w-lg': `${width}px`,
    '--ad-slot-h-lg': `${height}px`,
  } as CSSProperties;

  return (
    <div
      aria-hidden={ariaHidden || undefined}
      className={`w-full flex justify-center items-center my-6 ${outerClassName}`}
    >
      {/* A percentage width on the box alone resolves against this otherwise
          shrink-to-fit frame. GPT mounting/removal must not resize that frame. */}
      <div
        className="ogabassey-ad-slot-frame flex flex-col items-center"
        style={slotStyle}
      >
        <span className="ogabassey-ad-placeholder-text text-[9px] uppercase tracking-widest mb-1 self-start ml-1">
          Sponsored
        </span>
        <div
          ref={boxRef}
          className="ogabassey-ad-slot relative overflow-hidden bg-gray-50 border border-gray-100 flex flex-col items-center justify-center text-center shadow-sm"
          style={slotStyle}
        >
          {children}
          {showPlaceholder && (
            <div
              aria-hidden="true"
              className="absolute inset-0 w-full h-full flex flex-col items-center justify-center p-4 z-0"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(45deg, #e5e7eb 0, #e5e7eb 1px, transparent 1px, transparent 10px)',
              }}
            >
              <span className="ogabassey-ad-placeholder-text text-xs font-bold uppercase tracking-widest mb-1">
                Ad Space
              </span>
              <span className="ogabassey-ad-placeholder-text text-[10px] font-medium">
                {name}
              </span>
              <span className="ogabassey-ad-placeholder-text text-[9px] mt-1">
                {width}x{height}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
