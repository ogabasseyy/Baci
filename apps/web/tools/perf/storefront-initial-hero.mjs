import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

function getHeroStreamedSegments(document, hero) {
  return [...hero.querySelectorAll('template[id^="B:"]')]
    .map((template) =>
      document.getElementById(template.id.replace(/^B:/, 'S:'))
    )
    .filter((segment) => Boolean(segment?.hasAttribute('hidden')));
}

function hasVisibleFirstSlideContent(document, hero) {
  if (!hero.closest('main') || hero.closest('[hidden]')) {
    return false;
  }
  const mobileCarousels = [
    ...document.querySelectorAll('[data-ogabassey-mobile-hero]'),
  ];
  if (
    mobileCarousels.some(
      (carousel) =>
        !hero.contains(carousel) || Boolean(carousel.closest('[hidden]'))
    )
  ) {
    return false;
  }
  const scope = hero.querySelector('[data-ogabassey-mobile-hero]') ?? hero;
  const firstSlide = scope.querySelector('[role="group"]') ?? scope;
  const heading = firstSlide.querySelector('h2');
  const image = firstSlide.querySelector('img');
  return Boolean(
    heading?.textContent?.trim() &&
      !heading.closest('[hidden]') &&
      image &&
      !image.closest('[hidden]')
  );
}

function getHiddenOwnerIds(document, hero) {
  if (hasVisibleFirstSlideContent(document, hero)) {
    return [null];
  }
  const wrapperOwner = hero.closest('[hidden]')?.id ?? null;
  if (wrapperOwner) {
    return [wrapperOwner];
  }
  const hiddenMatches = [
    ...document.querySelectorAll('[hidden] [data-ogabassey-mobile-hero]'),
    ...getHeroStreamedSegments(document, hero).filter((segment) =>
      segment.querySelector('[data-ogabassey-mobile-hero], h2, img')
    ),
  ];
  if (hiddenMatches.length === 0) {
    return [null];
  }
  return [
    ...new Set(
      hiddenMatches.map((node) => node.closest('[hidden]')?.id ?? null)
    ),
  ];
}

/** Inspect parser-visible HTML without executing React's reveal scripts. */
export function inspectInitialHero(html) {
  const document = new JSDOM(html).window.document;
  const heroes = [...document.querySelectorAll('[data-ogabassey-hero]')];
  const visible = heroes.filter((hero) =>
    hasVisibleFirstSlideContent(document, hero)
  );
  const headings = [...document.querySelectorAll('h1')];
  return {
    pass:
      heroes.length === 1 &&
      visible.length === 1 &&
      headings.length === 1 &&
      !headings[0].closest('[hidden]'),
    heroCount: heroes.length,
    visibleHeroCount: visible.length,
    headingCount: headings.length,
    hiddenHeroOwners: heroes.flatMap((hero) =>
      getHiddenOwnerIds(document, hero)
    ),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (!process.argv[2])
    throw new Error('Usage: storefront-initial-hero.mjs <html>');
  const result = inspectInitialHero(readFileSync(process.argv[2], 'utf8'));
  console.log(JSON.stringify(result));
  if (!result.pass) process.exitCode = 1;
}
