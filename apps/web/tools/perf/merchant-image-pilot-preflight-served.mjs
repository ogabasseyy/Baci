// Served gate orchestration: fetch each lab page in each arm and run the
// agreement, mount-coverage, descriptor, response-bytes, and purity gates.

import { assertServedAgreement } from './merchant-image-pilot-preflight-agreement.mjs';
import { extractLabBindings } from './merchant-image-pilot-preflight-html.mjs';
import { assertServedMountCoverage } from './merchant-image-pilot-preflight-mounts.mjs';
import {
  assertControlPurity,
  assertServedDescriptors,
  assertServedResponseBytes,
} from './merchant-image-pilot-preflight-served-checks.mjs';
import { fail, pass } from './merchant-image-pilot-preflight-shared.mjs';

async function fetchPage(origin, pagePath, arm, timeoutMs) {
  const url = `${origin.replace(/\/$/, '')}${pagePath}?arm=${arm}`;
  const response = await fetch(url, {
    // Never follow: validating the redirect target would certify a
    // different route than the one named in the matrix (e.g. a store
    // page redirecting to the gallery, which holds the same binding).
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error(
      `GET ${url} redirected (${response.status}) to "${response.headers.get('location') ?? 'unknown'}" instead of serving the matrix route directly`
    );
  }
  // Belt and braces: the final URL must be the requested page URL.
  if (response.url && response.url !== url) {
    throw new Error(
      `GET ${url} resolved to "${response.url}" instead of serving the matrix route directly`
    );
  }
  if (!response.ok) {
    throw new Error(`GET ${url} -> ${response.status}`);
  }
  return response.text();
}

// Check-name prefix per page. The gallery keeps the historical
// `served:<arm>:` prefix; store pages are namespaced by slug so one
// failing store cannot hide behind another passing one.
function pageCheckPrefix(page) {
  if (page.surface === 'gallery') {
    return 'served';
  }
  const slug = page.path.split('/').pop() ?? 'store';
  return `served:store:${slug}`;
}

function withPrefix(prefix, name) {
  return name.replace(/^served/, prefix);
}

export async function fetchServedAgreement(
  origin,
  {
    arms,
    expectedBindings,
    expectedMounts = [],
    fetchImpl,
    pages,
    publicDir,
    timeoutMs = 10_000,
  }
) {
  const checks = [];
  const failures = [];
  const coverage = [];
  const effectivePages = pages ?? [
    { bindings: expectedBindings, path: '/pilot-lab', surface: 'gallery' },
  ];
  for (const page of effectivePages) {
    const prefix = pageCheckPrefix(page);
    const pageBindings = page.bindings ?? expectedBindings;
    const pageMounts = (page.mounts ?? expectedMounts).filter((mount) =>
      (pageBindings ?? []).includes(mount.binding)
    );
    for (const arm of arms) {
      const name = `${prefix}:${arm}:reachable`;
      let html;
      try {
        html = fetchImpl
          ? await fetchImpl(page, arm)
          : await fetchPage(origin, page.path, arm, timeoutMs);
      } catch (error) {
        fail(checks, failures, name, String(error.message ?? error));
        continue;
      }
      if (!html.includes(`data-pilot-lab-arm="${arm}"`)) {
        fail(
          checks,
          failures,
          name,
          'served page is not the requested lab arm'
        );
        continue;
      }
      pass(checks, name);
      if (Array.isArray(pageBindings)) {
        const rendered = new Set(extractLabBindings(html));
        const missing = pageBindings.filter(
          (binding) => !rendered.has(binding)
        );
        if (missing.length > 0) {
          fail(
            checks,
            failures,
            `${prefix}:${arm}:binding-coverage`,
            `served page drops bindings: ${missing.join(', ')}`
          );
        } else {
          pass(checks, `${prefix}:${arm}:binding-coverage`);
        }
      }
      const mountCoverage = assertServedMountCoverage(html, {
        arm,
        expectedMounts: pageMounts,
        origin,
        surface: page.surface,
      });
      for (const failure of mountCoverage.failures) {
        fail(
          checks,
          failures,
          `${prefix}:${arm}:mount-coverage`,
          failure.split(': ').slice(1).join(': ') || failure
        );
      }
      if (
        !failures.some((entry) =>
          entry.startsWith(`${prefix}:${arm}:mount-coverage`)
        )
      ) {
        pass(checks, `${prefix}:${arm}:mount-coverage`);
      }
      coverage.push({
        arm,
        expected: pageMounts.map((mount) => mount.binding),
        mounted: mountCoverage.mounted,
        page: page.path,
        reported: mountCoverage.reported,
      });
      for (const failure of assertServedAgreement(html, { arm })) {
        fail(
          checks,
          failures,
          `${prefix}:${arm}:owner-agreement`,
          failure.split(': ').slice(1).join(': ') || failure
        );
      }
      if (
        !failures.some((entry) =>
          entry.startsWith(`${prefix}:${arm}:owner-agreement`)
        )
      ) {
        pass(checks, `${prefix}:${arm}:owner-agreement`);
      }
      for (const failure of await assertServedDescriptors(html, {
        arm,
        origin,
        publicDir,
      })) {
        fail(
          checks,
          failures,
          withPrefix(prefix, failure.split(': ')[0]),
          failure.split(': ').slice(1).join(': ') || failure
        );
      }
      if (
        !failures.some((entry) =>
          entry.startsWith(`${prefix}:${arm}:descriptors`)
        )
      ) {
        pass(checks, `${prefix}:${arm}:descriptors`);
      }
      // Response bytes need a live origin; the HTML-injection seam cannot serve
      // them, so it skips this gate by construction.
      if (!fetchImpl) {
        for (const failure of await assertServedResponseBytes(html, {
          arm,
          origin,
          publicDir,
          timeoutMs,
        })) {
          fail(
            checks,
            failures,
            withPrefix(prefix, failure.split(': ')[0]),
            failure.split(': ').slice(1).join(': ') || failure
          );
        }
        if (
          !failures.some((entry) =>
            entry.startsWith(`${prefix}:${arm}:response-bytes`)
          )
        ) {
          pass(checks, `${prefix}:${arm}:response-bytes`);
        }
      }
      if (arm === 'control') {
        for (const failure of assertControlPurity(html, { origin })) {
          fail(
            checks,
            failures,
            `${prefix}:control:no-tier-leak`,
            failure.split(': ').slice(1).join(': ') || failure
          );
        }
        if (
          !failures.some((entry) =>
            entry.startsWith(`${prefix}:control:no-tier-leak`)
          )
        ) {
          pass(checks, `${prefix}:control:no-tier-leak`);
        }
      }
    }
  }
  return { checks, coverage, failures, ok: failures.length === 0 };
}
