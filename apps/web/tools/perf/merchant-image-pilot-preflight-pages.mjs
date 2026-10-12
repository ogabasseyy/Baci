// Served-page HTML builders for the merchant-image-pilot preflight entry
// suites: lab page scaffolds plus the staged-file responder the entry
// tests serve over local HTTP.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MERCHANT } from './merchant-image-pilot-preflight-fixtures.mjs';

export function labHtml({ arm, generationId, tiers }) {
  const srcSetFor = (format) =>
    tiers
      .filter((tier) => tier.format === format)
      .map((tier) => `/__pilot/${generationId}/${tier.path} ${tier.width}w`)
      .join(', ');
  const avif = srcSetFor('avif');
  const webp = srcSetFor('webp');
  const smallestTier = tiers.find((tier) => tier.format === 'avif');
  const smallest = smallestTier
    ? `/__pilot/${generationId}/${smallestTier.path}`
    : `/__pilot/${generationId}/placeholder.avif`;
  return `<!doctype html><html><body><main data-pilot-lab-arm="${arm}">
<section data-pilot-lab-slot="mobile-hero-slide-0" data-pilot-lab-binding="${MERCHANT}/hero-s0"><link rel="preload" as="image" href="${smallest}" imageSrcSet="${avif}" imageSizes="(max-width: 768px) 40vw, 152px" media="(max-width: 768px)" fetchPriority="high" type="image/avif" data-pilot-lab-preload="${arm}" data-pilot-lab-binding="${MERCHANT}/hero-s0"/><picture data-pilot-lab-picture="${arm}"><source media="(max-width: 768px)" sizes="(max-width: 768px) 40vw, 152px" srcSet="${avif}" type="image/avif"/><source media="(max-width: 768px)" sizes="(max-width: 768px) 40vw, 152px" srcSet="${webp}"/></picture></section>
<section data-pilot-lab-slot="header-logo" data-pilot-lab-binding="${MERCHANT}/logo-a"><picture data-pilot-lab-picture="${arm}"><source sizes="40px" srcSet="${avif}" type="image/avif"/><source sizes="40px" srcSet="${webp}" type="image/webp"/></picture></section>
</main></body></html>`;
}

export function notOptimizedSection(binding, slotId) {
  return `<section data-pilot-lab-slot="${slotId}" data-pilot-lab-binding="${binding}" data-pilot-lab-status="not-optimized"><h2>${slotId} — not optimized</h2><p>fixture row</p></section>`;
}

export function replaceHeroSection(html, replacement) {
  return String(html).replace(
    /<section data-pilot-lab-slot="mobile-hero-slide-0"[\s\S]*?<\/section>/,
    replacement
  );
}

export function contentTypeFor(base) {
  const extension = (base.split('.').pop() ?? '').toLowerCase();
  return (
    { avif: 'image/avif', png: 'image/png', webp: 'image/webp' }[extension] ??
    'application/octet-stream'
  );
}

export async function serveStaged(res, publicDir, urlPath) {
  // Static serving ignores the query: original-renderer ?w&q URLs hash
  // against the query-stripped staged file.
  const base = urlPath.split('?')[0];
  try {
    const bytes = await readFile(join(publicDir, base));
    res.writeHead(200, { 'content-type': contentTypeFor(base) }).end(bytes);
  } catch {
    res.writeHead(404).end('missing');
  }
}

export function srcSetFor(asset, generationId, format) {
  return asset.tiers
    .filter((tier) => tier.format === format)
    .map((tier) => `/__pilot/${generationId}/${tier.path} ${tier.width}w`)
    .join(', ');
}

export function storeLogoPilotPage({ arm, asset, heroRow }) {
  const avif = srcSetFor(asset, asset.generationId, 'avif');
  const webp = srcSetFor(asset, asset.generationId, 'webp');
  const fallback = asset.tiers.find((tier) => tier.format === 'webp');
  return `<!doctype html><html><body><div data-pilot-lab-arm="${arm}"><main><section data-pilot-lab-binding="${asset.merchantId}/${asset.assetId}" data-pilot-lab-slot="header-logo"><header data-pilot-lab-store-header="Labstore"><a href="/pilot-lab/store/labstore/"><picture data-pilot-lab-header-logo="true"><source sizes="40px" srcSet="${avif}" type="image/avif"/><source sizes="40px" srcSet="${webp}" type="image/webp"/><img src="/__pilot/${asset.generationId}/${fallback.path}" alt="Labstore" width="40" height="40"/></picture><span>Labstore</span></a></header></section>${heroRow}</main></div></body></html>`;
}

export function storeLogoControlPage({ asset, heroRow }) {
  const staged = asset.stagedOriginal;
  return `<!doctype html><html><body><div data-pilot-lab-arm="control"><main><section data-pilot-lab-binding="${asset.merchantId}/${asset.assetId}" data-pilot-lab-slot="header-logo"><header data-pilot-lab-store-header="Labstore"><a href="/pilot-lab/store/labstore/"><img src="${staged}?w=48&q=75" srcSet="${staged}?w=48&q=75 1x, ${staged}?w=96&q=75 2x" alt="Labstore" width="40" height="40"/></a></header></section>${heroRow}</main></div></body></html>`;
}
