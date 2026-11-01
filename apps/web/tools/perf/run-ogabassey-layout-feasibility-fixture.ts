import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractDependencyUrls } from './ogabassey-layout-dependencies';
import {
  validRoutePath,
  validStoreIdentifier,
} from './ogabassey-layout-identifiers';

type CaptureKind = 'home' | 'category' | 'pdp' | 'blog' | 'generic';

interface CaptureRecord {
  dependencyFiles: string[];
  headersPath: string;
  htmlPath: string;
  identifier: string;
  kind: CaptureKind;
  url: string;
}

interface AssetRecord {
  path: string;
  url: string;
}

export interface LayoutFeasibilityCaptureManifest {
  assets: AssetRecord[];
  captures: CaptureRecord[];
  version: 1;
}

interface FixtureOptions {
  baseUrl: string;
  blogPath: string;
  categoryPath: string;
  fetchImpl?: typeof fetch;
  genericIdentifier: string;
  identifiers: readonly [string, string] | readonly string[];
  outputDir: string;
  pdpPath: string;
}

function captureSpecs(options: FixtureOptions) {
  const [domainIdentifier, pathIdentifier] = options.identifiers;
  if (
    options.identifiers.length !== 2 ||
    !domainIdentifier ||
    !pathIdentifier ||
    domainIdentifier === pathIdentifier
  ) {
    throw new Error('Exactly two distinct OgaBassey identifiers are required');
  }

  const allIdentifiers = [
    domainIdentifier,
    pathIdentifier,
    options.genericIdentifier,
  ];
  if (
    allIdentifiers.some((identifier) => !validStoreIdentifier(identifier)) ||
    new Set(allIdentifiers.map((identifier) => identifier.toLowerCase()))
      .size !== 3
  ) {
    throw new Error('Invalid or overlapping storefront identifiers');
  }

  if (
    [options.categoryPath, options.pdpPath, options.blogPath].some(
      (route) => !validRoutePath(route)
    )
  ) {
    throw new Error('Invalid route path');
  }

  return [
    { identifier: domainIdentifier, kind: 'home' as const, suffix: '' },
    { identifier: pathIdentifier, kind: 'home' as const, suffix: '' },
    {
      identifier: pathIdentifier,
      kind: 'category' as const,
      suffix: options.categoryPath,
    },
    {
      identifier: pathIdentifier,
      kind: 'pdp' as const,
      suffix: options.pdpPath,
    },
    {
      identifier: pathIdentifier,
      kind: 'blog' as const,
      suffix: options.blogPath,
    },
    {
      identifier: options.genericIdentifier,
      kind: 'generic' as const,
      suffix: '',
    },
  ];
}

function outputName(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9.-]+/g, '-').replace(/^-|-$/g, '');
}

async function writeAsset(
  assetUrl: string,
  baseUrl: string,
  outputDir: string,
  fetchImpl: typeof fetch
): Promise<AssetRecord> {
  const response = await fetchImpl(new URL(assetUrl, baseUrl), {
    redirect: 'manual',
  });
  if (!response.ok) {
    throw new Error(`Dependency ${assetUrl} returned ${response.status}`);
  }
  const body = new Uint8Array(await response.arrayBuffer());
  const extension = path.extname(new URL(assetUrl, baseUrl).pathname) || '.bin';
  const digest = createHash('sha256').update(assetUrl).digest('hex');
  const relativePath = path.join('assets', `${digest}${extension}`);
  await writeFile(path.join(outputDir, relativePath), body);
  return { path: relativePath, url: assetUrl };
}

export async function runOgabasseyLayoutFeasibilityFixture(
  options: FixtureOptions
): Promise<LayoutFeasibilityCaptureManifest> {
  const base = new URL(options.baseUrl);
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) ||
    base.username ||
    base.password ||
    base.pathname !== '/' ||
    base.search ||
    base.hash
  ) {
    throw new Error('Capture server must be a loopback origin');
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  await mkdir(path.join(options.outputDir, 'html'), { recursive: true });
  await mkdir(path.join(options.outputDir, 'headers'), { recursive: true });
  await mkdir(path.join(options.outputDir, 'assets'), { recursive: true });

  const captures: CaptureRecord[] = [];
  const dependencyUrls = new Set<string>();
  for (const spec of captureSpecs(options)) {
    const pathname = [spec.identifier, spec.suffix].filter(Boolean).join('/');
    const url = new URL(`/${pathname}`, options.baseUrl).toString();
    const response = await fetchImpl(url, {
      headers: { 'user-agent': 'baci-cwv-layout-feasibility/1' },
      redirect: 'manual',
    });
    if (!response.ok) {
      throw new Error(
        `${spec.identifier} ${spec.kind} returned ${response.status}`
      );
    }
    const mediaType = response.headers
      .get('content-type')
      ?.split(';')[0]
      ?.trim()
      .toLowerCase();
    if (mediaType !== 'text/html') {
      throw new Error(`${spec.identifier} ${spec.kind} did not return HTML`);
    }
    const html = await response.text();
    const dependencyFiles = extractDependencyUrls(html, url);
    for (const dependency of dependencyFiles) dependencyUrls.add(dependency);

    const stem = outputName(`${spec.identifier}-${spec.kind}`);
    const htmlPath = path.join('html', `${stem}.html`);
    const headersPath = path.join('headers', `${stem}.json`);
    await writeFile(path.join(options.outputDir, htmlPath), html);
    await writeFile(
      path.join(options.outputDir, headersPath),
      JSON.stringify(Object.fromEntries(response.headers.entries()), null, 2)
    );
    captures.push({
      dependencyFiles,
      headersPath,
      htmlPath,
      identifier: spec.identifier,
      kind: spec.kind,
      url,
    });
  }

  const assets = await Promise.all(
    [...dependencyUrls]
      .sort()
      .map((url) =>
        writeAsset(url, options.baseUrl, options.outputDir, fetchImpl)
      )
  );
  const manifest: LayoutFeasibilityCaptureManifest = {
    assets,
    captures,
    version: 1,
  };
  await writeFile(
    path.join(options.outputDir, 'capture-manifest.json'),
    JSON.stringify(manifest, null, 2)
  );
  return manifest;
}

function readFlag(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing ${name}`);
  return value;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const identifiers = process.argv.flatMap((value, index) => {
    const next = process.argv[index + 1];
    return value === '--identifier' && next ? [next] : [];
  });
  const result = await runOgabasseyLayoutFeasibilityFixture({
    baseUrl: readFlag('--base-url'),
    blogPath: readFlag('--blog-path'),
    categoryPath: readFlag('--category-path'),
    genericIdentifier: readFlag('--generic-identifier'),
    identifiers,
    outputDir: readFlag('--output-dir'),
    pdpPath: readFlag('--pdp-path'),
  });
  console.log(JSON.stringify(result, null, 2));
}
