// Bakes same-origin AVIF snapshots for the OgaBassey mobile home-hero
// slide-0 image and regenerates the manifest consumed by
// `resolveOgabasseyHomeHeroSnapshot`.
//
// Why snapshots? The hero LCP image is served from the CDN behind a
// connection the document cannot warm early. A snapshot is the same pixels
// re-encoded at the same quality/geometry the CDN AVIF tier would serve,
// stored under `apps/web/public/_hero/<slug>/` so it ships same-origin with
// immutable caching (see vercel.json). The render path only uses a snapshot
// when the manifest holds the exact slide-0 URL being rendered — rotated
// content misses its key and falls back to the CDN automatically.
//
// Run:  node scripts/generate-ogabassey-hero-snapshots.mjs --slug ogabassey <sourceUrl> [...]
// Deps: sharp (already present via Next image optimization).
//
// The URL list is the COMPLETE set kept for the slug: entries not listed
// are dropped from the manifest and their orphaned `*.avif` files pruned.
// Always pass the committed slide-0 URL
// (OGABASSEY_HOME_COMMITTED_HERO_IMAGE_URL) first so the first-flush slot
// stays covered, plus any current shell slide-0 candidates.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const WEB_ROOT = resolve(ROOT, 'apps/web');
const MANIFEST_PATH = resolve(
  WEB_ROOT,
  'src/config/ogabassey-home-hero-snapshot-manifest.ts'
);

// Subset of next.config `deviceSizes` covering the mobile hero media range:
// (max-width: 767px) x 40vw x DPR<=3 needs at most ~920px; 1200 is headroom.
// Keep every entry a member of deviceSizes (asserted by unit test).
const SNAPSHOT_WIDTHS = [640, 750, 828, 1080, 1200];
// MUST equal MOBILE_HERO_IMAGE_QUALITY in
// apps/web/src/components/storefront/ogabassey/components/hero-mobile-image-config.ts.
// The value is written into each manifest entry and asserted by unit test.
const SNAPSHOT_QUALITY = 70;
const DEFAULT_WIDTH = 960;
const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
const MANAGED_FILE_PATTERN = /^[0-9a-f]{12}-\d+\.avif$/;

function fail(message) {
  console.error(`[hero-snapshots] ERROR: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let slug = null;
  const urls = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--slug') {
      slug = args[i + 1] ?? null;
      i += 1;
    } else if (args[i].startsWith('--')) {
      fail(`unknown flag ${args[i]}`);
    } else {
      urls.push(args[i]);
    }
  }
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    fail('pass --slug <storefront-slug> (lowercase alphanumerics and dashes)');
  }
  if (urls.length === 0) {
    fail('pass at least one CDN source URL to snapshot');
  }
  return { slug, urls: [...new Set(urls.map((u) => u.trim()))] };
}

async function fetchSource(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    fail(`not a URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') {
    fail(`refusing non-https source: ${url}`);
  }
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    fail(`fetch ${url} -> HTTP ${res.status}`);
  }
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.startsWith('image/')) {
    fail(`fetch ${url} -> unexpected content-type ${contentType}`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_SOURCE_BYTES) {
    fail(`fetch ${url} -> ${bytes.length} bytes (limit ${MAX_SOURCE_BYTES})`);
  }
  return bytes;
}

async function bakeSnapshots({ slug, urls }) {
  const outDir = resolve(WEB_ROOT, 'public/_hero', slug);
  mkdirSync(outDir, { recursive: true });
  const entries = [];
  for (const sourceUrl of urls) {
    const sourceBytes = await fetchSource(sourceUrl);
    const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
    const fileHash = sourceSha256.slice(0, 12);
    const meta = await sharp(sourceBytes).metadata();
    const sourceWidth = meta.width ?? 0;
    if (sourceWidth < Math.max(...SNAPSHOT_WIDTHS)) {
      // Never upscale: a source smaller than the widest snapshot would bake
      // blur. Fail loudly so the old manifest stays deployed instead.
      fail(
        `${sourceUrl} is ${sourceWidth}px wide, need >= ${Math.max(...SNAPSHOT_WIDTHS)}px`
      );
    }
    const candidates = [];
    for (const width of SNAPSHOT_WIDTHS) {
      const fileName = `${fileHash}-${width}.avif`;
      const filePath = resolve(outDir, fileName);
      // eslint-disable-next-line no-await-in-loop
      await sharp(sourceBytes)
        .resize({ width, withoutEnlargement: true })
        .avif({ quality: SNAPSHOT_QUALITY, effort: 4 })
        .toFile(filePath);
      // eslint-disable-next-line no-await-in-loop
      const baked = await sharp(filePath).metadata();
      if (baked.width !== width || baked.format !== 'heif') {
        fail(`${fileName}: baked ${baked.width}px/${baked.format}, want ${width}px/avif`);
      }
      candidates.push(`/_hero/${slug}/${fileName} ${width}w`);
      console.log(`[hero-snapshots] baked ${fileName}`);
    }
    const hrefWidth = [...SNAPSHOT_WIDTHS]
      .sort((a, b) => Math.abs(a - DEFAULT_WIDTH) - Math.abs(b - DEFAULT_WIDTH))[0];
    entries.push({
      sourceUrl,
      srcSet: candidates.join(', '),
      href: `/_hero/${slug}/${fileHash}-${hrefWidth}.avif`,
      quality: SNAPSHOT_QUALITY,
      widths: [...SNAPSHOT_WIDTHS].sort((a, b) => a - b),
      sourceSha256,
    });
  }
  return { entries, outDir };
}

function pruneOrphans(outDir, entries) {
  const referenced = new Set();
  for (const entry of entries) {
    referenced.add(entry.href.split('/').pop());
    for (const part of entry.srcSet.split(',')) {
      const file = part.trim().split(/\s+/)[0].split('/').pop();
      if (file) referenced.add(file);
    }
  }
  for (const file of readdirSync(outDir)) {
    // Only ever delete files this script could have written.
    if (!MANAGED_FILE_PATTERN.test(file) || referenced.has(file)) {
      continue;
    }
    rmSync(resolve(outDir, file));
    console.log(`[hero-snapshots] pruned orphan ${file}`);
  }
}

function writeManifest(slug, entries) {
  const existing = readFileSync(MANIFEST_PATH, 'utf8');
  const versionMatch = existing.match(
    /OGABASSEY_HOME_HERO_SNAPSHOT_MANIFEST_VERSION = (\d+)/
  );
  const version = versionMatch ? Number(versionMatch[1]) : 1;
  // Preserve other tenants' entries; this run owns only `slug`. The body is
  // evaluated as a TS object literal (not JSON.parse) so biome-formatted
  // output — single quotes, unquoted keys, trailing commas — round-trips.
  // This file is generator-owned; a hand-corrupted body fails loudly below.
  const otherTenants = {};
  const blockMatch = existing.match(/> = (\{[\s\S]*?\n\});\s*$/);
  if (blockMatch) {
    let parsed;
    try {
      parsed = new Function(`return (${blockMatch[1]});`)();
    } catch {
      fail('existing manifest body is not parseable; fix it before regenerating');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      fail('existing manifest body is not an object; fix it before regenerating');
    }
    for (const [key, value] of Object.entries(parsed)) {
      if (key !== slug) otherTenants[key] = value;
    }
  }
  const manifest = { ...otherTenants };
  manifest[slug] = {};
  for (const entry of [...entries].sort((a, b) =>
    a.sourceUrl.localeCompare(b.sourceUrl)
  )) {
    manifest[slug][entry.sourceUrl] = entry;
  }
  // TS body in the repo's quote style (single quotes, unquoted identifier
  // keys, trailing commas). Long lines are re-broken by biome below — the
  // reader tolerates any formatting, so hand edits and formatter output both
  // round-trip. Values are pipeline-controlled (URLs, paths, hex, numbers);
  // refuse to emit anything that would break single-quote serialization.
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
      fail(`value breaks manifest serialization: ${value.slice(0, 80)}`);
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
  const body = lines.join('\n');
  const header = `// DO NOT EDIT — generated by \`node scripts/generate-ogabassey-hero-snapshots.mjs\`.
// Same-origin AVIF snapshots for the OgaBassey mobile home-hero slide-0
// image, keyed by tenant slug then exact CDN source URL. A source URL with
// no entry here renders the legacy CDN path (rotation-safe by construction:
// rotated content misses its key and falls back instead of mismatching).
// Manifest version: ${version}. Generated: ${new Date().toISOString()}.

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
  writeFileSync(MANIFEST_PATH, `${header}${body};\n`);
  // Keep `pnpm lint` green immediately after regenerating: biome owns final
  // line-breaking (long URLs exceed the print width). Not fatal when biome
  // is unavailable — the manifest is valid either way; lint flags it later.
  const biomeBin = [ROOT, WEB_ROOT]
    .map((dir) => resolve(dir, 'node_modules/.bin/biome'))
    .find((bin) => existsSync(bin));
  if (biomeBin) {
    execFileSync(biomeBin, ['check', '--write', MANIFEST_PATH], {
      cwd: ROOT,
      stdio: 'pipe',
    });
  } else {
    console.warn('[hero-snapshots] WARN: biome not found; run biome check --write on the manifest');
  }
  console.log(
    `[hero-snapshots] wrote manifest (${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} for ${slug})`
  );
}

const { slug, urls } = parseArgs(process.argv);
const { entries, outDir } = await bakeSnapshots({ slug, urls });
pruneOrphans(outDir, entries);
writeManifest(slug, entries);
