import { pathToFileURL } from 'node:url';
import { extractDependencyUrls } from './ogabassey-layout-dependencies';
import {
  firstPostponedBoundaryOffset,
  hasHeroPreload,
  hasMarker,
  markerNeedles,
} from './ogabassey-layout-html';
import { validStoreIdentifier } from './ogabassey-layout-identifiers';
import {
  type LayoutCaptureManifest,
  layoutCaptureManifestSchema,
  prerenderManifestSchema,
} from './ogabassey-layout-manifest-schema';
import { loadAssetBodies } from './ogabassey-layout-prebuilt-assets';
import { readArtifactFile } from './ogabassey-layout-safe-file';

interface AssertionOptions {
  captureDir: string;
  cssSentinel: string;
  genericIdentifier: string;
  heroHint: string;
  identifiers: readonly string[];
  marker: string;
  nextDir: string;
  prebuiltDir: string;
}

interface AssertionReport {
  criticalDependencyFiles: string[];
  generatedIdentifiers: string[];
  markerOffsets: Record<string, number>;
  passed: true;
}

function asManifest(value: unknown): LayoutCaptureManifest {
  const parsed = layoutCaptureManifestSchema.safeParse(value);
  if (!parsed.success)
    throw new Error('Invalid layout feasibility capture manifest');
  return parsed.data;
}

async function readRawArtifact(
  nextDir: string,
  identifier: string
): Promise<string> {
  const candidates = [
    `server/app/${identifier}.html`,
    `server/app/${identifier}/page.html`,
    `server/app/${identifier}/index.html`,
  ];
  for (const candidate of candidates) {
    try {
      return (await readArtifactFile(nextDir, candidate)).toString('utf8');
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error.code === 'ENOENT' || error.code === 'ENOTDIR')
      )
        continue;
      throw error;
    }
  }
  throw new Error(`${identifier} raw route artifact was not found`);
}

export async function assertOgabasseyLayoutFeasibility(
  options: AssertionOptions
): Promise<AssertionReport> {
  if (
    options.identifiers.length !== 2 ||
    new Set(options.identifiers).size !== 2 ||
    options.identifiers.some((identifier) => !identifier)
  ) {
    throw new Error('Exactly two distinct OgaBassey identifiers are required');
  }
  if (
    [...options.identifiers, options.genericIdentifier].some(
      (identifier) => !validStoreIdentifier(identifier)
    )
  ) {
    throw new Error('Invalid storefront identifier');
  }
  if (
    options.identifiers.some(
      (identifier) =>
        identifier.toLowerCase() === options.genericIdentifier.toLowerCase()
    )
  ) {
    throw new Error('Overlapping generic storefront identifier');
  }
  const prerenderManifest = prerenderManifestSchema.parse(
    JSON.parse(
      (
        await readArtifactFile(options.nextDir, 'prerender-manifest.json')
      ).toString('utf8')
    )
  );
  const generatedIdentifiers = [...options.identifiers];
  const needles = markerNeedles(options.marker);
  const markerOffsets: Record<string, number> = {};
  const staticShells = new Map<string, string>();

  for (const identifier of generatedIdentifiers) {
    if (!prerenderManifest.routes?.[`/${identifier}`]) {
      throw new Error(`${identifier} was not prerendered`);
    }
    const html = await readRawArtifact(options.nextDir, identifier);
    const markerOffset = needles
      .map((needle) => html.indexOf(needle))
      .find((offset) => offset >= 0);
    const boundaryOffset = firstPostponedBoundaryOffset(html);
    if (
      markerOffset === undefined ||
      boundaryOffset === -1 ||
      markerOffset >= boundaryOffset
    ) {
      throw new Error(
        `${identifier} marker must appear before the first postponed boundary`
      );
    }
    if (!hasHeroPreload(html.slice(0, boundaryOffset), options.heroHint)) {
      throw new Error(
        `${identifier} hero preload is missing from the static shell`
      );
    }
    markerOffsets[identifier] = markerOffset;
    staticShells.set(identifier, html.slice(0, boundaryOffset));
  }

  const manifest = asManifest(
    JSON.parse(
      (
        await readArtifactFile(options.captureDir, 'capture-manifest.json')
      ).toString('utf8')
    )
  );
  const assetBodies = await loadAssetBodies(
    options.captureDir,
    options.prebuiltDir,
    manifest
  );
  const criticalDependencyFiles = [...assetBodies.entries()]
    .filter(
      ([, body]) =>
        body.includes(options.cssSentinel) || hasMarker(body, needles)
    )
    .map(([url]) => url)
    .sort();
  if (criticalDependencyFiles.length === 0) {
    throw new Error('No OgaBassey critical stylesheet or chunk was captured');
  }

  const homeCaptures = generatedIdentifiers.map((identifier) => {
    const matches = manifest.captures.filter(
      (item) => item.identifier === identifier && item.kind === 'home'
    );
    const [capture] = matches;
    if (matches.length !== 1 || !capture)
      throw new Error(`${identifier} home capture is missing or duplicated`);
    return capture;
  });
  for (const capture of homeCaptures) {
    for (const dependency of capture.dependencyFiles) {
      if (!assetBodies.has(dependency)) {
        throw new Error(`Missing captured dependency ${dependency}`);
      }
    }
    const servedHtml = (
      await readArtifactFile(options.captureDir, capture.htmlPath)
    ).toString('utf8');
    const servedDependencies = extractDependencyUrls(servedHtml, capture.url);
    const staticShell = staticShells.get(capture.identifier);
    if (staticShell === undefined)
      throw new Error(`${capture.identifier} static shell is missing`);
    const staticDependencies = extractDependencyUrls(staticShell, capture.url);
    if (
      staticDependencies.length === 0 ||
      staticDependencies.some(
        (dependency) => !servedDependencies.includes(dependency)
      )
    ) {
      throw new Error(
        `${capture.identifier} static-shell dependency is missing from served home`
      );
    }
    if (
      JSON.stringify(servedDependencies) !==
      JSON.stringify([...new Set(capture.dependencyFiles)].sort())
    ) {
      throw new Error(`${capture.identifier} dependency manifest mismatch`);
    }
    if (
      !hasMarker(servedHtml, needles) ||
      !hasHeroPreload(servedHtml, options.heroHint)
    ) {
      throw new Error(
        `${capture.identifier} served home is missing the marker or hero preload`
      );
    }
    for (const criticalFile of criticalDependencyFiles) {
      if (!capture.dependencyFiles.includes(criticalFile)) {
        throw new Error(
          `${capture.identifier} home is missing critical dependency ${criticalFile}`
        );
      }
    }
  }

  const negativeCaptures = manifest.captures.filter((capture) =>
    ['category', 'pdp', 'blog', 'generic'].includes(capture.kind)
  );
  for (const kind of ['category', 'pdp', 'blog', 'generic'] as const) {
    const identifier =
      kind === 'generic' ? options.genericIdentifier : options.identifiers[1];
    const matches = negativeCaptures.filter(
      (capture) => capture.kind === kind && capture.identifier === identifier
    );
    if (matches.length !== 1) {
      throw new Error(`${kind} capture is missing or duplicated`);
    }
  }
  for (const capture of negativeCaptures) {
    const html = (
      await readArtifactFile(options.captureDir, capture.htmlPath)
    ).toString('utf8');
    if (hasMarker(html, needles)) {
      throw new Error(`${capture.kind} capture leaked the critical marker`);
    }
    const servedDependencies = extractDependencyUrls(html, capture.url);
    if (
      JSON.stringify(servedDependencies) !==
      JSON.stringify([...new Set(capture.dependencyFiles)].sort())
    ) {
      throw new Error(`${capture.kind} dependency manifest mismatch`);
    }
    for (const dependency of capture.dependencyFiles) {
      const body = assetBodies.get(dependency);
      if (body === undefined)
        throw new Error(`Missing captured dependency ${dependency}`);
      if (
        criticalDependencyFiles.includes(dependency) ||
        body.includes(options.cssSentinel) ||
        hasMarker(body, needles)
      ) {
        throw new Error(
          `${capture.kind} leaked OgaBassey critical dependency ${dependency}`
        );
      }
    }
  }

  return {
    criticalDependencyFiles,
    generatedIdentifiers,
    markerOffsets,
    passed: true,
  };
}

function readFlags(name: string): string[] {
  return process.argv.flatMap((value, index) => {
    const next = process.argv[index + 1];
    return value === name && next ? [next] : [];
  });
}

function readFlag(name: string): string {
  const [value] = readFlags(name);
  if (!value || value.startsWith('--')) throw new Error(`Missing ${name}`);
  return value;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const report = await assertOgabasseyLayoutFeasibility({
    captureDir: readFlag('--capture-dir'),
    cssSentinel: readFlag('--css-sentinel'),
    genericIdentifier: readFlag('--generic-identifier'),
    heroHint: readFlag('--hero-hint'),
    identifiers: readFlags('--identifier'),
    marker: readFlag('--marker'),
    nextDir: readFlag('--next-dir'),
    prebuiltDir: readFlag('--prebuilt-dir'),
  });
  console.log(JSON.stringify(report, null, 2));
}
