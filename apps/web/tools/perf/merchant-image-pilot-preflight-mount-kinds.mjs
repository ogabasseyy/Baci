// Served mount-kind checks (extracted from
// merchant-image-pilot-preflight-mounts.mjs): hero, logo, and card
// validators plus the pilot-scope leak predicates they share.
import {
  pictureKind,
  relativizeServedUrl,
  sectionLabUrls,
  sectionPictures,
  sectionStandaloneImgs,
  srcSetCandidates,
  srcSetEveryHasPrefix,
  srcSetHasBase,
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

// Control-arm service: the mount serves the staged original from any
// rendered element — a typed source (store original-renderer heroes,
// synthetic control fixtures) or the bare fallback <img> (gallery
// control mounts, whose projection emits no typed sources).
function pictureServesOriginal(picture, mount, { origin }) {
  const sourceServes = picture.sources.some((source) =>
    srcSetHasBase(source.srcSet, mount.stagedOriginal, origin)
  );
  const img = picture.img;
  const imgServes =
    img != null &&
    (stripQuery(img.src, origin) === mount.stagedOriginal ||
      srcSetHasBase(img.srcset, mount.stagedOriginal, origin));
  return sourceServes || imgServes;
}

// Pilot fallback-<img> gate: the typed sources above are prefix-checked,
// but the fallback <img> serves bytes too — an unchecked img would pass
// while serving foreign bytes after all gates reported green. (A staged
// original in the img is already caught by the section leak check, which
// sweeps img src; this gate covers foreign bytes and broken fallbacks.)
// data: payloads are inline bytes, not served fetches: the mobile hero's
// transparent-pixel img carries nothing to audit. A picture with no <img>
// (synthetic fixtures) is likewise nothing to audit.
function pictureImgServesGeneration(picture, prefix, { origin }) {
  const img = picture.img;
  if (img == null) {
    return true;
  }
  const fetches = [];
  const src = String(img.src ?? '');
  if (src !== '' && !src.startsWith('data:')) {
    fetches.push(src);
  }
  const srcset = String(img.srcset ?? '');
  if (srcset !== '') {
    for (const candidate of srcSetCandidates(srcset)) {
      if (!String(candidate.url ?? '').startsWith('data:')) {
        fetches.push(candidate.url);
      }
    }
  }
  if (fetches.length === 0) {
    // Inline-only (the transparent pixel): nothing fetched, nothing to
    // audit. But an img with neither src nor srcset renders nothing — a
    // broken pilot fallback, not an audited one.
    return src !== '' || srcset !== '';
  }
  return fetches.every((url) => stripQuery(url, origin).startsWith(prefix));
}

export function checkHeroMount(section, mount, { arm, origin }) {
  const problems = [];
  // Gallery control heroes carry no media source (bare fallback <img>),
  // so they classify as gallery-picture, not gallery-hero.
  const pictures = sectionPictures(section.html).filter((picture) =>
    ['hero-slide', 'gallery-hero', 'gallery-picture', 'original-hero'].includes(
      pictureKind(picture)
    )
  );
  if (pictures.length === 0) {
    return ['no hero picture mounted'];
  }
  // Every mounted picture is audited, never just the first: a second hero
  // picture serving foreign bytes must not pass behind a clean first.
  const prefix = `/__pilot/${mount.generationId}/`;
  for (const picture of pictures) {
    // Gallery mounts carry their arm; store mounts inherit the page arm.
    const marked = picture.attrs['data-pilot-lab-picture'];
    if (marked != null && marked !== arm) {
      problems.push(`hero mount is marked for the ${marked} arm`);
    }
    if (arm === 'pilot') {
      const avif = picture.sources.find(
        (source) => source.type === 'image/avif'
      );
      if (!avif) {
        problems.push('pilot hero mount has no AVIF source');
        continue;
      }
      if (!srcSetEveryHasPrefix(avif.srcSet, prefix, origin)) {
        problems.push(
          'pilot hero AVIF source serves bytes outside this generation'
        );
      }
      const fallback = picture.sources.find((source) => !source.type);
      if (!fallback) {
        problems.push('pilot hero mount has no fallback source');
      } else if (!srcSetEveryHasPrefix(fallback.srcSet, prefix, origin)) {
        problems.push(
          'pilot hero fallback source serves bytes outside this generation'
        );
      }
      if (!pictureImgServesGeneration(picture, prefix, { origin })) {
        problems.push(
          'pilot hero fallback img serves bytes outside this generation'
        );
      }
      continue;
    }
    if (!pictureServesOriginal(picture, mount, { origin })) {
      problems.push('control hero mount does not serve the staged original');
    }
  }
  if (
    arm === 'pilot' &&
    pilotScopeLeaksOriginal(section.html, { arm, origin })
  ) {
    problems.push(
      'pilot hero mount fetches a staged original instead of the generation copy'
    );
  }
  return problems;
}

export function checkLogoMount(section, mount, { arm, origin, surface }) {
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
  // Every mounted picture is audited, never just the first: a second logo
  // picture serving foreign bytes must not pass behind a clean first.
  const prefix = `/__pilot/${mount.generationId}/`;
  for (const picture of pictures) {
    const marked = picture.attrs['data-pilot-lab-picture'];
    if (marked != null && marked !== arm) {
      problems.push(`logo mount is marked for the ${marked} arm`);
    }
    if (arm === 'control' && surface !== 'store') {
      // Gallery control: the AVIF requirement is pilot-only. The real
      // mount is a bare fallback <img> (no typed sources); accept any
      // rendered element serving the staged original.
      if (!pictureServesOriginal(picture, mount, { origin })) {
        problems.push('control logo mount does not serve the staged original');
      }
      continue;
    }
    const avif = picture.sources.find((source) => source.type === 'image/avif');
    if (!avif) {
      problems.push('logo mount has no AVIF source');
      continue;
    }
    if (arm === 'pilot') {
      // Every typed source (AVIF and WebP alike): an unreviewed rung in an
      // unchecked source would pass while serving foreign bytes.
      const outside = picture.sources.some(
        (source) => !srcSetEveryHasPrefix(source.srcSet, prefix, origin)
      );
      if (outside) {
        problems.push('pilot logo mount serves bytes outside this generation');
      }
      if (!pictureImgServesGeneration(picture, prefix, { origin })) {
        problems.push(
          'pilot logo fallback img serves bytes outside this generation'
        );
      }
    } else if (!srcSetHasBase(avif.srcSet, mount.stagedOriginal, origin)) {
      problems.push('control logo mount does not serve the staged original');
    }
  }
  if (
    arm === 'pilot' &&
    pilotScopeLeaksOriginal(section.html, { arm, origin })
  ) {
    problems.push(
      'pilot logo mount fetches a staged original instead of the generation copy'
    );
  }
  return problems;
}

export function checkCardMount(section, mount, { arm, origin, surface }) {
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
  // Every mounted picture is audited, never just the first: a second card
  // picture serving foreign bytes must not pass behind a clean first.
  const prefix = `/__pilot/${mount.generationId}/`;
  for (const picture of pictures) {
    const marked = picture.attrs['data-pilot-lab-picture'];
    if (marked != null && marked !== arm) {
      problems.push(`card mount is marked for the ${marked} arm`);
    }
    if (arm === 'control' && surface !== 'store') {
      // Gallery control: the AVIF requirement is pilot-only. The real
      // mount is a bare fallback <img> (no typed sources); accept any
      // rendered element serving the staged original.
      if (!pictureServesOriginal(picture, mount, { origin })) {
        problems.push('control card mount does not serve the staged original');
      }
      continue;
    }
    const avif = picture.sources.find((source) => source.type === 'image/avif');
    if (!avif) {
      problems.push('card mount has no AVIF source');
      continue;
    }
    if (arm === 'pilot') {
      // Every typed source (AVIF and WebP alike): an unreviewed rung in an
      // unchecked source would pass while serving foreign bytes.
      const outside = picture.sources.some(
        (source) => !srcSetEveryHasPrefix(source.srcSet, prefix, origin)
      );
      if (outside) {
        problems.push('pilot card mount serves bytes outside this generation');
      }
      if (!pictureImgServesGeneration(picture, prefix, { origin })) {
        problems.push(
          'pilot card fallback img serves bytes outside this generation'
        );
      }
    } else if (!srcSetHasBase(avif.srcSet, mount.stagedOriginal, origin)) {
      problems.push('control card mount does not serve the staged original');
    }
  }
  if (arm === 'pilot' && pilotScopeLeaksOriginal(scope, { arm, origin })) {
    problems.push(
      'pilot card mount fetches a staged original instead of the generation copy'
    );
  }
  return problems;
}
