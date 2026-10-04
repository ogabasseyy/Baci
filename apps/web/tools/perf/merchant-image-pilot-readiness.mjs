// Browser readiness gate for the merchant image pilot.
//
// Loads every sampled store surface in both arms in real Chrome across the
// required profile matrix (mobile DPR 1/2/3 + desktop) and fails closed
// unless the surface is measurement-ready: styles delivered (computed
// styles, never class names), responsive geometry holds, layout matches
// across arms, the selected image decoded from a staged URL, and no failed
// requests or console errors pollute the run. Timing is NOT measured here
// — this gate qualifies the surface before any quiet-window comparison.
//
// Usage:
//   node merchant-image-pilot-readiness.mjs --origin=http://localhost:3122 \
//     --store-map='merchant-uuid=slug,...' --hero-stores='ogabassey' \
//     --mounts=<preflight-accepted.json> --chrome='/path/to/Chrome' \
//     [--profiles=mobile-390-dpr2,desktop-1365-dpr1]
// Exits 0 with a JSON report on stdout when ready; exit 1 otherwise.
//
// --mounts is the offline preflight accepted list (preflight
// --write-mounts): every expected bound slot per store is validated in the
// browser — visibility, decode, arm-correct staged URL, cross-arm layout —
// not just the primary surface. Mobile-only bindings (the md:hidden hero)
// invert on desktop profiles: the section must render, but hidden —
// decode verdicts stay with the mobile profiles that show it.
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import {
  crossArmProblems,
  surfaceProblems,
} from './merchant-image-pilot-readiness-checks.mjs';
import {
  parseArgs,
  parseMountsJson,
  parseProfiles,
  parseStoreMap,
  READINESS_CLI_OPTIONS,
  READINESS_PROFILES,
} from './merchant-image-pilot-readiness-config.mjs';

async function collectSurface(page, url, surface) {
  const consoleErrors = [];
  const failedRequests = [];
  const imageUrls = [];
  const origin = new URL(url).origin;
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text().slice(0, 200));
    }
  });
  page.on('pageerror', (error) => {
    consoleErrors.push(String(error).slice(0, 200));
  });
  page.on('response', (response) => {
    const responseUrl = response.url();
    if (!responseUrl.startsWith(origin)) {
      return;
    }
    if (response.status() >= 400) {
      failedRequests.push(`${response.status()} ${responseUrl.slice(-80)}`);
    }
    const contentType = response.headers()['content-type'] ?? '';
    if (contentType.startsWith('image/')) {
      imageUrls.push(responseUrl);
    }
  });
  // Network-level failures (DNS, reset, aborted) never produce a response.
  page.on('requestfailed', (request) => {
    const requestUrl = request.url();
    if (!requestUrl.startsWith(origin)) {
      return;
    }
    failedRequests.push(
      `requestfailed ${requestUrl.slice(-80)} (${request.failure()?.errorText ?? 'unknown'})`
    );
  });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  const geometry = await page.evaluate((surface) => {
    const rectOf = (element) => {
      if (!element) {
        return null;
      }
      const rect = element.getBoundingClientRect();
      return {
        height: rect.height,
        width: rect.width,
        x: rect.x,
        y: rect.y,
      };
    };
    const heading = document.querySelector('h1.sr-only');
    // Grid stores check the selected card wrapper; hero-only stores check
    // the mounted hero image in its bound section.
    const selected =
      surface === 'hero'
        ? document.querySelector(
            '[data-pilot-lab-slot="mobile-hero-slide-0"] img'
          )
        : document.querySelector('[data-pilot-lab-selected-card]');
    const selectedImg =
      surface === 'hero' ? selected : (selected?.querySelector('img') ?? null);
    const grid = surface === 'hero' ? null : (selected?.parentElement ?? null);
    // Every bound slot on the page — reporting rows included, so a slot
    // that renders only a status marker fails as "not a mount" instead of
    // escaping the gate silently.
    const slots = [...document.querySelectorAll('[data-pilot-lab-slot]')].map(
      (section) => {
        const img = section.querySelector('img');
        return {
          binding: section.getAttribute('data-pilot-lab-binding'),
          img: img
            ? {
                complete: img.complete,
                currentSrc: img.currentSrc,
                naturalWidth: img.naturalWidth,
              }
            : null,
          rect: rectOf(section),
          slotId: section.getAttribute('data-pilot-lab-slot'),
          status: section.getAttribute('data-pilot-lab-status'),
        };
      }
    );
    const sheets = performance
      .getEntriesByType('resource')
      .filter(
        (entry) => entry.initiatorType === 'link' && entry.name.endsWith('.css')
      );
    return {
      gridDisplay: grid ? getComputedStyle(grid).display : 'n/a-hero',
      heading: rectOf(heading),
      imgObjectFit: selectedImg
        ? getComputedStyle(selectedImg).objectFit
        : null,
      selected: rectOf(selected),
      selectedImg: selectedImg
        ? {
            complete: selectedImg.complete,
            currentSrc: selectedImg.currentSrc,
            naturalWidth: selectedImg.naturalWidth,
          }
        : null,
      slots,
      stylesheetBytes: sheets.reduce(
        (sum, entry) => sum + (entry.encodedBodySize ?? 0),
        0
      ),
      stylesheetCount: sheets.length,
      viewportWidth: window.innerWidth,
    };
  }, surface);
  return { consoleErrors, failedRequests, geometry, imageUrls };
}

async function run() {
  const failures = [];
  const checks = [];
  const pass = (name) => checks.push({ name, ok: true });
  const fail = (name, detail) => {
    checks.push({ name, ok: false });
    failures.push(`${name}: ${detail}`);
  };
  let args;
  try {
    args = parseArgs(process.argv.slice(2), READINESS_CLI_OPTIONS);
  } catch (error) {
    fail('usage', error instanceof Error ? error.message : String(error));
    return { checks, failures, ok: false };
  }
  if (!args.origin || !args['store-map'] || !args.chrome || !args.mounts) {
    fail('usage', 'need --origin, --store-map, --mounts and --chrome');
    return { checks, failures, ok: false };
  }
  let stores;
  let expectedMounts;
  try {
    expectedMounts = parseMountsJson(await readFile(args.mounts, 'utf8'));
    stores = parseStoreMap(args['store-map'], expectedMounts);
  } catch (error) {
    fail('usage', error instanceof Error ? error.message : String(error));
    return { checks, failures, ok: false };
  }
  let profiles;
  try {
    profiles = parseProfiles(args.profiles);
  } catch (error) {
    fail('usage', error instanceof Error ? error.message : String(error));
    return { checks, failures, ok: false };
  }
  let browser;
  try {
    browser = await chromium.launch({
      args: ['--no-sandbox'],
      executablePath: args.chrome,
    });
  } catch (error) {
    fail(
      'browser-launch',
      error instanceof Error ? error.message : String(error)
    );
    return { checks, failures, ok: false };
  }
  try {
    const heroStores = new Set(
      String(args['hero-stores'] ?? '')
        .split(',')
        .map((slug) => slug.trim())
        .filter((slug) => slug.length > 0)
    );
    for (const store of stores) {
      const surface = heroStores.has(store.slug) ? 'hero' : 'grid';
      const expectedFit = surface === 'hero' ? 'contain' : 'cover';
      const mounts = expectedMounts.filter(
        (mount) => mount.merchantId === store.merchantId
      );
      if (mounts.length === 0) {
        fail(
          `store:${store.slug}:mounts`,
          `no expected mounts for merchant "${store.merchantId}"`
        );
        continue;
      }
      for (const profile of profiles) {
        const surfaces = {};
        const device = READINESS_PROFILES[profile];
        for (const arm of ['control', 'pilot']) {
          const name = `store:${store.slug}:${arm}:${profile}`;
          const context = await browser.newContext({
            deviceScaleFactor: device.deviceScaleFactor,
            hasTouch: device.hasTouch,
            isMobile: device.isMobile,
            viewport: device.viewport,
          });
          try {
            const page = await context.newPage();
            const collected = await collectSurface(
              page,
              `${args.origin}/pilot-lab/store/${store.slug}?arm=${arm}`,
              surface
            );
            surfaces[arm] = collected;
            const problems = surfaceProblems(collected, {
              arm,
              expectHiddenMounts:
                surface === 'hero' && profile.startsWith('desktop'),
              expectedFit,
              expectedMounts: mounts,
              surface,
            });
            if (problems.length > 0) {
              fail(name, problems.join('; '));
            } else {
              pass(name);
            }
          } finally {
            await context.close();
          }
        }
        const pair = `store:${store.slug}:cross-arm-layout:${profile}`;
        const pairProblems = crossArmProblems(
          surfaces.control?.geometry,
          surfaces.pilot?.geometry,
          mounts
        );
        if (pairProblems.length > 0) {
          fail(pair, pairProblems.join('; '));
        } else {
          pass(pair);
        }
      }
    }
  } finally {
    await browser.close();
  }
  return { checks, failures, ok: failures.length === 0 };
}

const isMain = process.argv[1]?.endsWith('merchant-image-pilot-readiness.mjs');
if (isMain) {
  run().then(
    (report) => {
      console.log(JSON.stringify(report, null, 2));
      process.exitCode = report.ok ? 0 : 1;
    },
    (error) => {
      console.log(
        JSON.stringify({
          checks: [],
          failures: [`readiness crashed: ${String(error).slice(0, 300)}`],
          ok: false,
        })
      );
      process.exitCode = 1;
    }
  );
}
