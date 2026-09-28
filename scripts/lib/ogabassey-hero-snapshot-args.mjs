// CLI argument parsing for the hero snapshot pipeline.

import { HeroSnapshotError } from './ogabassey-hero-snapshot-errors.mjs';

export function parseSnapshotArgs(argv) {
  const args = argv.slice(2);
  let slug = null;
  const urls = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--slug') {
      slug = args[i + 1] ?? null;
      i += 1;
    } else if (args[i].startsWith('--')) {
      throw new HeroSnapshotError(`unknown flag ${args[i]}`);
    } else {
      urls.push(args[i]);
    }
  }
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    throw new HeroSnapshotError(
      'pass --slug <storefront-slug> (lowercase alphanumerics and dashes)'
    );
  }
  if (urls.length === 0) {
    throw new HeroSnapshotError('pass at least one CDN source URL to snapshot');
  }
  return { slug, urls: [...new Set(urls.map((u) => u.trim()))] };
}
