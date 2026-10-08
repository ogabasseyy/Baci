// Served byte-level gates: width descriptors vs decoded bytes, control
// purity (no staged derivatives in the control arm), and served response
// bytes vs staged hashes. Staged-asset fetches must serve directly: a
// redirect to another host or route breaks the promised same-origin
// delivery topology even when the final bytes hash identically.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { orientedDimensions } from '../../../../infra/cdn-transformer/pilot/encode-worker.mjs';
import {
  extractLabPreloads,
  extractLabSections,
  relativizeServedUrl,
  sectionLabUrls,
  sectionPictures,
  sectionStandaloneImgs,
  srcSetCandidates,
  stripQuery,
} from './merchant-image-pilot-preflight-html.mjs';
import { sha256Hex } from './merchant-image-pilot-preflight-shared.mjs';

// Staged lab bytes are images: the served gate pins the response MIME to
// the staged file's image type. Typed <picture> sources and preloads can
// fail to decode (or to be reused) under stricter MIME handling even when
// the bytes hash identically, so octet-stream/wrong-type responses fail.
const CONTENT_TYPE_FOR_EXTENSION = {
  avif: 'image/avif',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};

// Bounded response read: at most maxBytes stream through the reader, so a
// runaway origin cannot exhaust the validator. Reports truncation (the
// caller fails the byte check) and cancels the body on overflow.
export async function readBoundedBody(response, maxBytes) {
  if (!response.body) {
    return { bytes: Buffer.alloc(0), truncated: false };
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        return { bytes: Buffer.concat(chunks), truncated: false };
      }
      total += value.byteLength;
      if (total > maxBytes) {
        return { bytes: Buffer.alloc(0), truncated: true };
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function assertServedDescriptors(
  html,
  { arm, origin, publicDir }
) {
  const failures = [];
  const name = `served:${arm}:descriptors`;
  for (const section of extractLabSections(html)) {
    if (section.status) {
      continue;
    }
    const candidates = [];
    for (const picture of sectionPictures(section.html)) {
      for (const source of picture.sources) {
        candidates.push(...srcSetCandidates(source.srcSet));
      }
    }
    // Standalone original-renderer imgs (store control arm): same rules —
    // loader-param URLs verify existence+decode, bare width descriptors
    // must match the decoded bytes.
    for (const img of sectionStandaloneImgs(section.html)) {
      if (img.src) {
        candidates.push({ descriptor: null, url: img.src });
      }
      candidates.push(...srcSetCandidates(img.srcset));
    }
    for (const candidate of candidates) {
      // Relativize BEFORE the query split: a bare absolute staged URL has
      // no loader params, so it must still verify its width descriptor.
      const path = relativizeServedUrl(candidate.url, origin);
      const base = path.split('?')[0];
      if (!base.startsWith('/__pilot/')) {
        failures.push(
          `${name}: lab srcSet serves a non-lab URL "${candidate.url}"`
        );
        continue;
      }
      // Loader-param URLs (?w&q from the original renderers) name a
      // REQUESTED width, not the encoded width: the staged file must
      // exist and decode, but no descriptor match applies.
      if (path !== base) {
        try {
          await sharp(join(publicDir, base)).metadata();
        } catch {
          failures.push(`${name}: staged file does not decode: "${base}"`);
        }
        continue;
      }
      if (candidate.descriptor === null) {
        // Bare lab URLs (no-op control srcSets, standalone img src):
        // the staged file must exist and decode.
        try {
          await sharp(join(publicDir, base)).metadata();
        } catch {
          failures.push(`${name}: staged file does not decode: "${base}"`);
        }
        continue;
      }
      if (!Number.isInteger(candidate.descriptor) || candidate.descriptor < 1) {
        failures.push(
          `${name}: invalid width descriptor for "${candidate.url}"`
        );
        continue;
      }
      let meta;
      try {
        meta = await sharp(join(publicDir, base)).metadata();
      } catch {
        failures.push(
          `${name}: staged file does not decode: "${candidate.url}"`
        );
        continue;
      }
      // Oriented width: an EXIF-rotated pass-through tier renders at
      // its oriented axes (which the descriptor claims), while sharp
      // reports the stored axes plus an orientation tag.
      const oriented = orientedDimensions(meta);
      if (oriented.width !== candidate.descriptor) {
        failures.push(
          `${name}: descriptor ${candidate.descriptor}w does not match oriented width ${oriented.width}: "${candidate.url}"`
        );
      }
    }
  }
  return failures;
}

export function assertControlPurity(html, { origin } = {}) {
  const leaked = [];
  for (const section of extractLabSections(html)) {
    if (section.status) {
      continue;
    }
    for (const url of sectionLabUrls(section.html, 'control')) {
      if (/^\/__pilot\/[0-9a-f]{64}\//.test(stripQuery(url, origin))) {
        leaked.push(url);
      }
    }
  }
  if (leaked.length > 0) {
    return [
      `served:control:no-tier-leak: control arm serves staged derivatives: ${leaked[0]}`,
    ];
  }
  return [];
}

export async function assertServedResponseBytes(
  html,
  { arm, origin, publicDir, timeoutMs }
) {
  const failures = [];
  const name = `served:${arm}:response-bytes`;
  const urls = new Set();
  const collect = (url) => {
    if (stripQuery(url, origin).startsWith('/__pilot/')) {
      urls.add(url);
    }
  };
  for (const section of extractLabSections(html)) {
    if (section.status) {
      continue;
    }
    for (const url of sectionLabUrls(section.html, arm)) {
      collect(url);
    }
  }
  // Hoisted hint links live in <head>, outside every section: their bytes
  // verify like any other lab URL.
  for (const link of extractLabPreloads(html)) {
    if (link.arm !== arm) {
      continue;
    }
    if (link.href) {
      collect(link.href);
    }
    for (const candidate of srcSetCandidates(link.imageSrcSet)) {
      collect(candidate.url);
    }
  }
  if (urls.size === 0) {
    failures.push(`${name}: no lab image URLs found to verify`);
    return failures;
  }
  for (const urlPath of urls) {
    // Loader-param URLs fetch with the query (as browsers do) but hash
    // against the query-stripped staged file (static serving ignores it).
    const stagedPath = stripQuery(urlPath, origin);
    let expected;
    try {
      expected = await readFile(join(publicDir, stagedPath));
    } catch {
      failures.push(`${name}: no staged file for "${stagedPath}"`);
      continue;
    }
    // Absolute same-origin lab URLs fetch as-is; relative ones resolve
    // against the served origin.
    const fetchUrl = /^https?:\/\//.test(urlPath)
      ? urlPath
      : `${origin.replace(/\/$/, '')}${urlPath}`;
    let response;
    try {
      response = await fetch(fetchUrl, {
        // Never follow: a redirect to another host or route breaks the
        // promised same-origin delivery topology (extra connection path)
        // even when the final bytes hash identically.
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      failures.push(
        `served:${arm}:response-bytes: GET "${urlPath}" failed (${error.message})`
      );
      continue;
    }
    if (response.status >= 300 && response.status < 400) {
      failures.push(
        `served:${arm}:response-bytes: GET "${urlPath}" redirected (${response.status}) to "${response.headers.get('location') ?? 'unknown'}" instead of serving staged bytes directly`
      );
      await response.body?.cancel?.().catch(() => {
        // Best-effort drain; the redirect failure is already recorded.
      });
      continue;
    }
    // Belt and braces: the final URL must be the requested staged URL.
    if (response.url && response.url !== fetchUrl) {
      failures.push(
        `served:${arm}:response-bytes: GET "${urlPath}" resolved to "${response.url}" instead of serving staged bytes directly`
      );
      continue;
    }
    if (!response.ok) {
      failures.push(
        `served:${arm}:response-bytes: GET "${urlPath}" -> ${response.status}`
      );
      continue;
    }
    const extension = (stagedPath.split('.').pop() ?? '').toLowerCase();
    const expectedType = CONTENT_TYPE_FOR_EXTENSION[extension];
    if (!expectedType) {
      failures.push(
        `served:${arm}:response-bytes: no known image content type for staged file "${stagedPath}"`
      );
      continue;
    }
    const servedType = (response.headers.get('content-type') ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (servedType !== expectedType) {
      failures.push(
        `served:${arm}:response-bytes: GET "${urlPath}" served content-type "${servedType || 'missing'}", expected "${expectedType}" for staged "${stagedPath}"`
      );
      continue;
    }
    // Bounded by the staged size: a runaway origin serving a huge or
    // unending body rejects on overflow instead of exhausting the
    // validation process inside arrayBuffer().
    const served = await readBoundedBody(response, expected.length + 1);
    if (served.truncated) {
      failures.push(
        `served:${arm}:response-bytes: GET "${urlPath}" exceeded the staged ${expected.length} bytes`
      );
      continue;
    }
    if (sha256Hex(served.bytes) !== sha256Hex(expected)) {
      failures.push(
        `served:${arm}:response-bytes: served bytes differ from the staged hash: "${urlPath}"`
      );
    }
  }
  return failures;
}
