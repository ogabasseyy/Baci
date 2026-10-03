// Served mount coverage: every intended accepted binding must have an
// actual mount of the expected kind/identity — not just a reporting row.
// Reporting rows (not-optimized / missing-binding) are collected for the
// audit trail and excluded from optimized coverage; an expected mount that
// renders only a reporting row fails.

import {
  extractLabSections,
  pictureKind,
  relativizeServedUrl,
  sectionLabUrls,
  sectionPictures,
  sectionStandaloneImgs,
  srcSetHasBase,
  srcSetHasPrefix,
  stripQuery,
} from './merchant-image-pilot-preflight-html.mjs';
import { selectedCardSubtree } from './merchant-image-pilot-selected-card.mjs';

// Intended pass-through serves the verified copy from the binding's own
// generation URL; a staged-original fetch inside pilot scope is an
// accidental double download (or leak), never intended delivery.
function pilotScopeLeaksOriginal(scopeHtml, { arm, origin }) {
  if (arm !== 'pilot') {
    return false;
  }
  return sectionLabUrls(scopeHtml, arm).some((url) => {
    const base = relativizeServedUrl(url, origin).split('?')[0];
    return base.startsWith('/__pilot/originals/');
  });
}

function checkHeroMount(section, mount, { arm, origin }) {
  const problems = [];
  const pictures = sectionPictures(section.html).filter((picture) =>
    ['hero-slide', 'gallery-hero', 'original-hero'].includes(
      pictureKind(picture)
    )
  );
  if (pictures.length === 0) {
    return ['no hero picture mounted'];
  }
  const picture = pictures[0];
  // Gallery mounts carry their arm; store mounts inherit the page arm.
  const marked = picture.attrs['data-pilot-lab-picture'];
  if (marked != null && marked !== arm) {
    problems.push(`hero mount is marked for the ${marked} arm`);
  }
  if (arm === 'pilot') {
    const avif = picture.sources.find((source) => source.type === 'image/avif');
    if (!avif) {
      problems.push('pilot hero mount has no AVIF source');
      return problems;
    }
    if (
      !srcSetHasPrefix(avif.srcSet, `/__pilot/${mount.generationId}/`, origin)
    ) {
      problems.push('pilot hero AVIF source does not serve this generation');
    }
    const fallback = picture.sources.find((source) => !source.type);
    if (!fallback) {
      problems.push('pilot hero mount has no fallback source');
    } else if (
      !srcSetHasPrefix(
        fallback.srcSet,
        `/__pilot/${mount.generationId}/`,
        origin
      )
    ) {
      problems.push(
        'pilot hero fallback source does not serve this generation'
      );
    }
    if (pilotScopeLeaksOriginal(section.html, { arm, origin })) {
      problems.push(
        'pilot hero mount fetches a staged original instead of the generation copy'
      );
    }
    return problems;
  }
  const rendered =
    picture.sources.find((source) => source.type === 'image/avif') ??
    picture.sources.find((source) => source.media);
  if (
    !rendered ||
    !srcSetHasBase(rendered.srcSet, mount.stagedOriginal, origin)
  ) {
    problems.push('control hero mount does not serve the staged original');
  }
  return problems;
}

function checkLogoMount(section, mount, { arm, origin, surface }) {
  const problems = [];
  if (arm === 'control' && surface === 'store') {
    // Original-renderer lockup: a bare <img> over the staged original
    // (loader ?w&q params are inert for local files).
    const serves = sectionStandaloneImgs(section.html).some(
      (img) =>
        stripQuery(img.src, origin) === mount.stagedOriginal ||
        srcSetHasBase(img.srcset, mount.stagedOriginal, origin)
    );
    if (!serves) {
      problems.push('control lockup does not serve the staged original');
    }
    return problems;
  }
  const pictures = sectionPictures(section.html).filter((picture) =>
    ['header-logo', 'gallery-picture'].includes(pictureKind(picture))
  );
  if (pictures.length === 0) {
    return ['no logo picture mounted'];
  }
  const marked = pictures[0].attrs['data-pilot-lab-picture'];
  if (marked != null && marked !== arm) {
    problems.push(`logo mount is marked for the ${marked} arm`);
  }
  const avif = pictures[0].sources.find(
    (source) => source.type === 'image/avif'
  );
  if (!avif) {
    problems.push('logo mount has no AVIF source');
    return problems;
  }
  if (arm === 'pilot') {
    if (
      !srcSetHasPrefix(avif.srcSet, `/__pilot/${mount.generationId}/`, origin)
    ) {
      problems.push('pilot logo mount does not serve this generation');
    }
    if (pilotScopeLeaksOriginal(section.html, { arm, origin })) {
      problems.push(
        'pilot logo mount fetches a staged original instead of the generation copy'
      );
    }
  } else if (!srcSetHasBase(avif.srcSet, mount.stagedOriginal, origin)) {
    problems.push('control logo mount does not serve the staged original');
  }
  return problems;
}

function checkCardMount(section, mount, { arm, origin, surface }) {
  const problems = [];
  // Store surface: scope to the selected-card subtree in BOTH arms. The
  // gallery has no grid fillers, so its sections check whole.
  const scope =
    surface === 'store' ? selectedCardSubtree(section.html) : section.html;
  if (surface === 'store' && scope === null) {
    return ['selected card wrapper is absent'];
  }
  if (arm === 'control' && surface === 'store') {
    // Original-renderer grid: the selected card's bare <img> over the staged
    // original. The card path serves absolute same-origin staged URLs (the
    // original renderer rejects relative ones), relativized before
    // comparison. Fillers are outside the scope by construction.
    const serves = sectionStandaloneImgs(scope).some(
      (img) =>
        stripQuery(img.src, origin) === mount.stagedOriginal ||
        srcSetHasBase(img.srcset, mount.stagedOriginal, origin)
    );
    if (!serves) {
      problems.push('control grid does not serve the staged original');
    }
    return problems;
  }
  const kinds =
    surface === 'store' ? ['card-image'] : ['card-image', 'gallery-picture'];
  const pictures = sectionPictures(scope).filter((picture) =>
    kinds.includes(pictureKind(picture))
  );
  if (pictures.length === 0) {
    return ['no card picture mounted'];
  }
  if (surface === 'store' && arm === 'pilot' && pictures.length !== 1) {
    problems.push(
      `pilot grid mounts ${pictures.length} card pictures instead of exactly the mounted card`
    );
  }
  const marked = pictures[0].attrs['data-pilot-lab-picture'];
  if (marked != null && marked !== arm) {
    problems.push(`card mount is marked for the ${marked} arm`);
  }
  const avif = pictures[0].sources.find(
    (source) => source.type === 'image/avif'
  );
  if (!avif) {
    problems.push('card mount has no AVIF source');
    return problems;
  }
  if (arm === 'pilot') {
    if (
      !srcSetHasPrefix(avif.srcSet, `/__pilot/${mount.generationId}/`, origin)
    ) {
      problems.push('pilot card mount does not serve this generation');
    }
    if (pilotScopeLeaksOriginal(scope, { arm, origin })) {
      problems.push(
        'pilot card mount fetches a staged original instead of the generation copy'
      );
    }
  } else if (!srcSetHasBase(avif.srcSet, mount.stagedOriginal, origin)) {
    problems.push('control card mount does not serve the staged original');
  }
  return problems;
}

function checkMountKind(section, mount, { arm, origin, surface }) {
  if (mount.role === 'hero') {
    return checkHeroMount(section, mount, { arm, origin });
  }
  if (mount.role === 'logo') {
    return checkLogoMount(section, mount, { arm, origin, surface });
  }
  return checkCardMount(section, mount, { arm, origin, surface });
}

export function assertServedMountCoverage(
  html,
  { arm, expectedMounts, origin, surface }
) {
  const failures = [];
  const mounted = [];
  const reported = [];
  const sections = extractLabSections(html);
  const byBinding = new Map(
    sections
      .filter((section) => section.binding)
      .map((section) => [section.binding, section])
  );
  for (const section of sections) {
    if (section.status) {
      reported.push({
        binding: section.binding,
        slotId: section.slotId,
        status: section.status,
      });
    }
  }
  for (const mount of expectedMounts ?? []) {
    const name = `mount-coverage:${mount.binding}`;
    const section = byBinding.get(mount.binding);
    if (!section) {
      failures.push(
        `${name}: expected ${mount.slotId} mount is absent from the served ${surface} ${arm} page`
      );
      continue;
    }
    if (section.status) {
      failures.push(
        `${name}: expected ${mount.slotId} mount renders only "${section.status}"`
      );
      continue;
    }
    const problems = checkMountKind(section, mount, { arm, origin, surface });
    if (problems.length > 0) {
      for (const problem of problems) {
        failures.push(`${name}: ${problem}`);
      }
      continue;
    }
    mounted.push(mount.binding);
  }
  return { failures, mounted, reported };
}
