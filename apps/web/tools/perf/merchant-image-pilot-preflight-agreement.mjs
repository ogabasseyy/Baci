// Served hint agreement: every mounted hero section pairs its OWN preload
// link with its OWN rendered picture. React hoists <link rel=preload> to
// <head>, so served sections never contain their link — pairing is by the
// link's data-pilot-lab-binding identity (emitted by PilotLabScannerLink),
// never by subtree position or document order. A link for another binding
// (or no binding at all) never pairs, and a mounted hero without its own
// link fails (no vacuous zero-to-zero pass). The pilot arm gates on
// image/avif; the control arm serves format-agnostic bytes and omits type.
import {
  extractLabPreloads,
  extractLabSections,
  pictureKind,
  sectionPictures,
  srcSetCandidates,
} from './merchant-image-pilot-preflight-html.mjs';

export function assertServedAgreement(html, { arm }) {
  const failures = [];
  const name = `served:${arm}:owner-agreement`;
  // Every bound, unreported section is a pairing candidate — not just the
  // hero slot. The hero-kind picture filter below skips header/card
  // sections, while a hero picture mis-mounted under a foreign slot still
  // has to pair with its own link instead of slipping past the filter.
  const heroSections = extractLabSections(html).filter(
    (section) => section.binding != null && !section.status
  );
  const docLinks = extractLabPreloads(html).filter((link) => link.arm === arm);
  for (const section of heroSections) {
    const pictures = sectionPictures(section.html).filter((picture) =>
      ['hero-slide', 'gallery-hero', 'original-hero'].includes(
        pictureKind(picture)
      )
    );
    if (pictures.length === 0) {
      // No mounted hero picture: mount-coverage owns the absence verdict.
      continue;
    }
    const links = docLinks.filter(
      (link) => link.binding != null && link.binding === section.binding
    );
    if (links.length === 0) {
      failures.push(
        `${name}: mounted hero section ${section.binding} has no preload link`
      );
      continue;
    }
    if (links.length !== pictures.length) {
      failures.push(
        `${name}: section ${section.binding} pairs ${links.length} preload links with ${pictures.length} hero pictures`
      );
      continue;
    }
    links.forEach((link, position) => {
      const picture = pictures[position];
      // The rendered srcSet the hint must match: the AVIF tier when the
      // mount has one (lab mounts), else the media source the original
      // renderer paints (store control hero).
      const rendered =
        picture.sources.find((source) => source.type === 'image/avif') ??
        picture.sources.find((source) => source.media);
      if (link.rel !== 'preload' || link.as !== 'image') {
        failures.push(
          `${name}: section ${section.binding} link ${position} is not rel=preload as=image`
        );
        return;
      }
      if (!rendered) {
        failures.push(
          `${name}: section ${section.binding} picture ${position} has no rendered media source`
        );
        return;
      }
      if (link.imageSrcSet !== rendered.srcSet) {
        failures.push(
          `${name}: section ${section.binding} link ${position} imageSrcSet differs from the rendered source`
        );
      }
      if (link.imageSizes !== rendered.sizes) {
        failures.push(
          `${name}: section ${section.binding} link ${position} imageSizes differs from the rendered source`
        );
      }
      if (link.media !== rendered.media) {
        failures.push(
          `${name}: section ${section.binding} link ${position} media differs from the rendered source`
        );
      }
      if (arm === 'pilot' ? link.type !== 'image/avif' : link.type != null) {
        failures.push(
          `${name}: section ${section.binding} link ${position} has the wrong format gate for the ${arm} arm`
        );
      }
      if (link.fetchPriority !== 'high') {
        failures.push(
          `${name}: section ${section.binding} link ${position} fetchPriority is not high`
        );
      }
      const candidates = srcSetCandidates(link.imageSrcSet).map(
        (entry) => entry.url
      );
      if (!candidates.includes(link.href)) {
        failures.push(
          `${name}: section ${section.binding} link ${position} href is not one of the preloaded candidates`
        );
      }
    });
  }
  return failures;
}
