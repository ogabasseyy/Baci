// Same-origin AVIF snapshot pipeline for the OgaBassey mobile home-hero
// slide-0 image. Bakes per-width AVIFs, prunes orphans, and regenerates the
// manifest consumed by `resolveOgabasseyHomeHeroSnapshot`.
//
// Why snapshots? The hero LCP image is served from the CDN behind a
// connection the document cannot warm early. A snapshot is the same pixels
// re-encoded at the same quality/geometry the CDN AVIF tier would serve,
// stored under `apps/web/public/_hero/<slug>/` so it ships same-origin with
// immutable caching (see vercel.json). The render path only uses a snapshot
// when the manifest holds the exact slide-0 URL being rendered — rotated
// content misses its key and falls back to the CDN automatically.
//
// Invoked via scripts/generate-ogabassey-hero-snapshots.mjs:
//   node scripts/generate-ogabassey-hero-snapshots.mjs --slug ogabassey <sourceUrl> [...]
// The URL list is the COMPLETE set kept for the slug: entries not listed
// are dropped from the manifest and their orphaned `*.avif` files pruned.
// Always pass the committed slide-0 URL
// (OGABASSEY_HOME_COMMITTED_HERO_IMAGE_URL) first so the first-flush slot
// stays covered, plus any current shell slide-0 candidates.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// The mobile hero's responsive ladder, mirroring what next/image emits for
// the AVIF tier (get-img-props getWidths: allSizes at or above
// deviceSizes[0] x smallest-vw-ratio = 640 x 0.40 = 256 — so 256/384 from
// Next's default imageSizes ARE real emitted buckets; see also
// HOME_HERO_IMAGE_WIDTH_QUALITY_PAIRS in ogabassey-image-prewarm-pairs.ts).
// Tiers at/above 1440 are excluded: the <source> is capped at
// (max-width: 767px), so the largest reachable pick is ~920px (767 x 40vw x
// DPR 3); 1200 is headroom covering DPR <= 3.9. Keep in sync with the
// PIPELINE_WIDTHS mirrors in the apps/web snapshot tests.
export const SNAPSHOT_WIDTHS = [256, 384, 640, 750, 828, 1080, 1200];
// MUST equal MOBILE_HERO_IMAGE_QUALITY in
// apps/web/src/components/storefront/ogabassey/components/hero-mobile-image-config.ts.
// The value is written into each manifest entry and asserted by unit test.
export const SNAPSHOT_QUALITY = 70;
export const DEFAULT_WIDTH = 960;
export const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
export const MANAGED_FILE_PATTERN = /^[0-9a-f]{12}-\d+\.avif$/;

export class HeroSnapshotError extends Error {
  constructor(message) {
    super(message);
    this.name = 'HeroSnapshotError';
  }
}

function snapshotError(message) {
  // Untagged: the CLI wrapper adds the `[hero-snapshots] ERROR:` prefix.
  return new HeroSnapshotError(message);
}

export function defaultWebRoot() {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '../../apps/web');
}

export function defaultManifestPath(webRoot) {
  return resolve(webRoot, 'src/config/ogabassey-home-hero-snapshot-manifest.ts');
}

export function parseSnapshotArgs(argv) {
  const args = argv.slice(2);
  let slug = null;
  const urls = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--slug') {
      slug = args[i + 1] ?? null;
      i += 1;
    } else if (args[i].startsWith('--')) {
      throw snapshotError(`unknown flag ${args[i]}`);
    } else {
      urls.push(args[i]);
    }
  }
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    throw snapshotError(
      'pass --slug <storefront-slug> (lowercase alphanumerics and dashes)'
    );
  }
  if (urls.length === 0) {
    throw snapshotError('pass at least one CDN source URL to snapshot');
  }
  return { slug, urls: [...new Set(urls.map((u) => u.trim()))] };
}

export async function fetchSnapshotSource(url, fetchImpl) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw snapshotError(`not a URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') {
    throw snapshotError(`refusing non-https source: ${url}`);
  }
  const res = await fetchImpl(url, { redirect: 'follow' });
  if (!res.ok) {
    throw snapshotError(`fetch ${url} -> HTTP ${res.status}`);
  }
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.startsWith('image/')) {
    throw snapshotError(`fetch ${url} -> unexpected content-type ${contentType}`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_SOURCE_BYTES) {
    throw snapshotError(`fetch ${url} -> ${bytes.length} bytes (limit ${MAX_SOURCE_BYTES})`);
  }
  return bytes;
}

export async function bakeSnapshots({
  fetchImpl,
  outDir,
  sharpImpl,
  slug,
  urls,
}) {
  mkdirSync(outDir, { recursive: true });
  const entries = [];
  for (const sourceUrl of urls) {
    // eslint-disable-next-line no-await-in-loop
    const sourceBytes = await fetchSnapshotSource(sourceUrl, fetchImpl);
    const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
    // eslint-disable-next-line no-await-in-loop
    const meta = await sharpImpl(sourceBytes).metadata();
    const sourceWidth = meta.width ?? 0;
    if (sourceWidth < Math.max(...SNAPSHOT_WIDTHS)) {
      // Never upscale: a source smaller than the widest snapshot would bake
      // blur. Fail loudly so the old manifest stays deployed instead.
      throw snapshotError(
        `${sourceUrl} is ${sourceWidth}px wide, need >= ${Math.max(...SNAPSHOT_WIDTHS)}px`
      );
    }
    const filesByWidth = new Map();
    for (const width of SNAPSHOT_WIDTHS) {
      // Encode to a buffer first: the filename hash covers the ENCODED
      // bytes, so a quality/encoder/sharp change mints a new URL instead of
      // overwriting an `immutable`-cached one.
      // eslint-disable-next-line no-await-in-loop
      const encoded = await sharpImpl(sourceBytes)
        .resize({ width, withoutEnlargement: true })
        .avif({ quality: SNAPSHOT_QUALITY, effort: 4 })
        .toBuffer();
      const fileHash = createHash('sha256').update(encoded).digest('hex').slice(0, 12);
      const fileName = `${fileHash}-${width}.avif`;
      const filePath = resolve(outDir, fileName);
      writeFileSync(filePath, encoded);
      // eslint-disable-next-line no-await-in-loop
      const baked = await sharpImpl(filePath).metadata();
      if (baked.width !== width || baked.format !== 'heif') {
        throw snapshotError(
          `${fileName}: baked ${baked.width}px/${baked.format}, want ${width}px/avif`
        );
      }
      filesByWidth.set(width, fileName);
      console.log(`[hero-snapshots] baked ${fileName}`);
    }
    const candidates = [...filesByWidth.entries()]
      .sort(([a], [b]) => a - b)
      .map(([width, fileName]) => `/_hero/${slug}/${fileName} ${width}w`);
    const hrefWidth = [...SNAPSHOT_WIDTHS].sort(
      (a, b) => Math.abs(a - DEFAULT_WIDTH) - Math.abs(b - DEFAULT_WIDTH)
    )[0];
    entries.push({
      sourceUrl,
      srcSet: candidates.join(', '),
      href: `/_hero/${slug}/${filesByWidth.get(hrefWidth)}`,
      quality: SNAPSHOT_QUALITY,
      widths: [...SNAPSHOT_WIDTHS].sort((a, b) => a - b),
      sourceSha256,
    });
  }
  return entries;
}

export function pruneSnapshotOrphans(outDir, entries) {
  const referenced = new Set();
  for (const entry of entries) {
    referenced.add(entry.href.split('/').pop());
    for (const part of entry.srcSet.split(',')) {
      const file = part.trim().split(/\s+/)[0].split('/').pop();
      if (file) referenced.add(file);
    }
  }
  const pruned = [];
  for (const file of readdirSync(outDir)) {
    // Only ever delete files this pipeline could have written.
    if (!MANAGED_FILE_PATTERN.test(file) || referenced.has(file)) {
      continue;
    }
    rmSync(resolve(outDir, file));
    pruned.push(file);
    console.log(`[hero-snapshots] pruned orphan ${file}`);
  }
  return pruned;
}

export function readSnapshotManifestTenants(existing) {
  const versionMatch = existing.match(
    /OGABASSEY_HOME_HERO_SNAPSHOT_MANIFEST_VERSION = (\d+)/
  );
  const version = versionMatch ? Number(versionMatch[1]) : 1;
  // The body is evaluated as a TS object literal (not JSON.parse) so
  // biome-formatted output — single quotes, unquoted keys, trailing commas —
  // round-trips. This file is generator-owned; a hand-corrupted body fails
  // loudly below.
  const tenants = {};
  const blockMatch = existing.match(/> = (\{[\s\S]*?\n\});\s*$/);
  if (blockMatch) {
    let parsed;
    try {
      parsed = new Function(`return (${blockMatch[1]});`)();
    } catch {
      throw snapshotError(
        'existing manifest body is not parseable; fix it before regenerating'
      );
    }
    Object.assign(tenants, parsed);
  }
  return { tenants, version };
}

export function serializeSnapshotManifestBody(manifest) {
  // TS body in the repo's quote style (single quotes, unquoted identifier
  // keys, trailing commas). Long lines are re-broken by biome after writing
  // — the reader tolerates any formatting, so hand edits and formatter
  // output both round-trip. Values are pipeline-controlled (URLs, paths,
  // hex, numbers); refuse to emit anything that would break single-quote
  // serialization.
  const allStrings = [];
  for (const [tenant, tenantEntries] of Object.entries(manifest)) {
    allStrings.push(tenant);
    for (const entry of Object.values(tenantEntries)) {
      allStrings.push(
        entry.sourceUrl,
        entry.srcSet,
        entry.href,
        entry.sourceSha256
      );
    }
  }
  for (const value of allStrings) {
    if (value.includes("'") || value.includes('"') || value.includes('`')) {
      throw snapshotError(
        `value breaks manifest serialization: ${value.slice(0, 80)}`
      );
    }
  }
  const IDENTIFIER_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
  const key = (name) => (IDENTIFIER_KEY.test(name) ? name : `'${name}'`);
  const lines = ['{'];
  for (const tenant of Object.keys(manifest).sort()) {
    lines.push(`  ${key(tenant)}: {`);
    const tenantEntries = manifest[tenant];
    for (const url of Object.keys(tenantEntries).sort()) {
      const entry = tenantEntries[url];
      lines.push(`    '${url}': {`);
      lines.push(`      sourceUrl: '${entry.sourceUrl}',`);
      lines.push(`      srcSet: '${entry.srcSet}',`);
      lines.push(`      href: '${entry.href}',`);
      lines.push(`      quality: ${entry.quality},`);
      lines.push(`      widths: [${entry.widths.join(', ')}],`);
      lines.push(`      sourceSha256: '${entry.sourceSha256}',`);
      lines.push('    },');
    }
    lines.push('  },');
  }
  lines.push('}');
  return lines.join('\n');
}

export function serializeSnapshotManifestFile(manifest, version, generatedAt) {
  const header = `// DO NOT EDIT — generated by \`node scripts/generate-ogabassey-hero-snapshots.mjs\`.
// Same-origin AVIF snapshots for the OgaBassey mobile home-hero slide-0
// image, keyed by tenant slug then exact CDN source URL. A source URL with
// no entry here renders the legacy CDN path (rotation-safe by construction:
// rotated content misses its key and falls back instead of mismatching).
// Manifest version: ${version}. Generated: ${generatedAt}.

export interface OgabasseyHomeHeroSnapshotManifestEntry {
  sourceUrl: string;
  srcSet: string;
  href: string;
  /** Encode quality the snapshot was baked at; must equal
   *  MOBILE_HERO_IMAGE_QUALITY (asserted by unit test). */
  quality: number;
  /** Width descriptors present in srcSet (ascending). */
  widths: number[];
  /** sha256 of the source bytes the snapshot was baked from (audit only;
   *  runtime matching is by exact sourceUrl key, never by hash). */
  sourceSha256: string;
}

export const OGABASSEY_HOME_HERO_SNAPSHOT_MANIFEST_VERSION = ${version};

export const OGABASSEY_HOME_HERO_SNAPSHOT_MANIFEST: Record<
  string,
  Record<string, OgabasseyHomeHeroSnapshotManifestEntry>
> = `;
  return `${header}${serializeSnapshotManifestBody(manifest)};\n`;
}

export async function writeSnapshotManifest({
  entries,
  manifestPath,
  root,
  skipBiomeFormat = false,
  slug,
  webRoot,
}) {
  let existing;
  try {
    existing = readFileSync(manifestPath, 'utf8');
  } catch {
    throw snapshotError(
      `manifest not found at ${manifestPath}; it is checked in with the repo`
    );
  }
  const { tenants, version } = readSnapshotManifestTenants(existing);
  // Preserve other tenants' entries; this run owns only `slug`.
  const manifest = {};
  for (const [key, value] of Object.entries(tenants)) {
    if (key !== slug) manifest[key] = value;
  }
  manifest[slug] = {};
  for (const entry of [...entries].sort((a, b) =>
    a.sourceUrl.localeCompare(b.sourceUrl)
  )) {
    manifest[slug][entry.sourceUrl] = entry;
  }
  writeFileSync(
    manifestPath,
    serializeSnapshotManifestFile(manifest, version, new Date().toISOString())
  );
  // Keep `pnpm lint` green immediately after regenerating: biome owns final
  // line-breaking (long URLs exceed the print width). Not fatal when biome
  // is unavailable — the manifest is valid either way; lint flags it later.
  if (!skipBiomeFormat) {
    const biomeBin = [root, webRoot]
      .map((dir) => resolve(dir, 'node_modules/.bin/biome'))
      .find((bin) => existsSync(bin));
    if (biomeBin) {
      execFileSync(biomeBin, ['check', '--write', manifestPath], {
        cwd: root,
        stdio: 'pipe',
      });
    } else {
      console.warn(
        '[hero-snapshots] WARN: biome not found; run biome check --write on the manifest'
      );
    }
  }
  console.log(
    `[hero-snapshots] wrote manifest (${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} for ${slug})`
  );
}

export async function runGenerateOgabasseyHeroSnapshots(argv, deps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sharpImpl = deps.sharpImpl ?? sharp;
  const webRoot = deps.webRoot ?? defaultWebRoot();
  const manifestPath = deps.manifestPath ?? defaultManifestPath(webRoot);
  const root = deps.root ?? resolve(webRoot, '../..');
  const { slug, urls } = parseSnapshotArgs(argv);
  const outDir = resolve(webRoot, 'public/_hero', slug);
  const entries = await bakeSnapshots({
    fetchImpl,
    outDir,
    sharpImpl,
    slug,
    urls,
  });
  pruneSnapshotOrphans(outDir, entries);
  await writeSnapshotManifest({
    entries,
    manifestPath,
    root,
    skipBiomeFormat: deps.skipBiomeFormat ?? false,
    slug,
    webRoot,
  });
  return { entries, outDir, slug };
}
