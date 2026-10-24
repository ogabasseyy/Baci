import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

/** Inspect parser-visible HTML without executing React's reveal scripts. */
export function inspectInitialHero(html) {
  const document = new JSDOM(html).window.document;
  const heroes = [...document.querySelectorAll('[data-ogabassey-hero]')];
  const visible = heroes.filter(
    (hero) => hero.closest('main') && !hero.closest('[hidden]')
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
    hiddenHeroOwners: heroes.map(
      (hero) => hero.closest('[hidden]')?.id ?? null
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
