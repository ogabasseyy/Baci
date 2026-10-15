import type { PilotInventoryBinding } from '@/schemas/merchant-image-variant-pilot';

// Reported-not-optimized row, shared by the gallery and the per-store pages
// so the served markers are identical everywhere preflight reads them.
// Unaccepted, unresolved, or unmounted slots are REPORTED here — never
// silently omitted, never counted as optimized coverage.
//
// baselineSrc renders the staged control original alongside the status
// (inside this same status section, so every gate keeps skipping it as
// non-coverage): operators can see and validate the baseline image for
// the excluded binding instead of reading a text row that merely claims
// the control path is retained.
export function PilotLabNotOptimized({
  baselineAlt,
  baselineSrc,
  binding,
  reason,
}: {
  baselineAlt?: string;
  baselineSrc?: string | null;
  binding: PilotInventoryBinding;
  reason: string;
}): React.JSX.Element {
  return (
    <section
      data-pilot-lab-binding={`${binding.merchantId}/${binding.assetId}`}
      data-pilot-lab-slot={binding.slotId}
      data-pilot-lab-status="not-optimized"
    >
      <h2>
        {binding.slotId} · {binding.assetId} — not optimized
      </h2>
      <p>{reason}</p>
      {baselineSrc ? (
        <figure>
          {/* biome-ignore lint/performance/noImgElement: baseline must serve the exact staged bytes with no loader transform, and unaccepted bindings have no decoded dimensions for next/image. */}
          <img
            alt={baselineAlt ?? `${binding.assetId} staged control baseline`}
            decoding="async"
            loading="lazy"
            src={baselineSrc}
          />
          <figcaption>
            staged control baseline — excluded from the optimized denominator
          </figcaption>
        </figure>
      ) : null}
    </section>
  );
}
