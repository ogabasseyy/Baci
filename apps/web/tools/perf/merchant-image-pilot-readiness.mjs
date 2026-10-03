// Browser readiness gate for the merchant image pilot.
//
// Loads every sampled store surface in both arms in real Chrome (mobile
// viewport) and fails closed unless the surface is measurement-ready:
// styles delivered (computed styles, never class names), responsive geometry
// holds, layout matches across arms, selected image identities hold, and no
// failed requests or console errors pollute the run. Timing is NOT measured
// here — this gate qualifies the surface before any quiet-window comparison.
//
// Usage:
//   node merchant-image-pilot-readiness.mjs --origin=http://localhost:3122 \
//     --store-map='merchant-uuid=slug,...' --hero-stores='ogabassey' \
//     --chrome='/path/to/Chrome'
// Exits 0 with a JSON report on stdout when ready; exit 1 otherwise.
import { chromium } from 'playwright';

const VIEWPORT = { height: 844, width: 390 };

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const match = /^--([a-z-]+)=(.*)$/.exec(argv[i]);
    if (match) {
      args[match[1]] = match[2];
    }
  }
  return args;
}

function parseStoreMap(value) {
  return String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const [merchantId, slug] = entry.split('=');
      if (!merchantId || !slug) {
        throw new Error(`bad --store-map entry: ${entry}`);
      }
      return { merchantId, slug };
    });
}

// Rounded-box equality: identical DOM + identical CSS must lay out
// identically. Rounding absorbs subpixel serialization, nothing more.
export function boxesMatch(left, right) {
  for (const key of ['x', 'y', 'width', 'height']) {
    if (Math.round(left[key]) !== Math.round(right[key])) {
      return false;
    }
  }
  return true;
}

export function pilotImageUrlsOk(urls) {
  return urls.every((url) => !url.includes('/originals/'));
}

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
  const args = parseArgs(process.argv.slice(2));
  const failures = [];
  const checks = [];
  const pass = (name) => checks.push({ name, ok: true });
  const fail = (name, detail) => {
    checks.push({ name, ok: false });
    failures.push(`${name}: ${detail}`);
  };
  if (!args.origin || !args['store-map'] || !args.chrome) {
    fail('usage', 'need --origin, --store-map and --chrome');
    return { checks, failures, ok: false };
  }
  let stores;
  try {
    stores = parseStoreMap(args['store-map']);
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
      const surfaces = {};
      const surface = heroStores.has(store.slug) ? 'hero' : 'grid';
      const expectedFit = surface === 'hero' ? 'contain' : 'cover';
      for (const arm of ['control', 'pilot']) {
        const name = `store:${store.slug}:${arm}`;
        const context = await browser.newContext({
          deviceScaleFactor: 2,
          hasTouch: true,
          isMobile: true,
          viewport: VIEWPORT,
        });
        try {
          const page = await context.newPage();
          const collected = await collectSurface(
            page,
            `${args.origin}/pilot-lab/store/${store.slug}?arm=${arm}`,
            surface
          );
          surfaces[arm] = collected;
          const problems = [];
          if (collected.consoleErrors.length > 0) {
            problems.push(
              `console errors: ${collected.consoleErrors.join(' | ')}`
            );
          }
          if (collected.failedRequests.length > 0) {
            problems.push(
              `failed requests: ${collected.failedRequests.join(' | ')}`
            );
          }
          const g = collected.geometry;
          if (g.stylesheetCount < 1 || g.stylesheetBytes < 1) {
            problems.push('no stylesheet delivered');
          }
          if (!g.heading || g.heading.width > 1 || g.heading.height > 1) {
            problems.push('sr-only heading occupies visible space');
          }
          if (!g.selected) {
            problems.push('selected slot absent');
          } else if (g.selected.x + g.selected.width > g.viewportWidth + 1) {
            problems.push('selected slot overflows the viewport');
          }
          if (surface === 'grid' && g.gridDisplay !== 'grid') {
            problems.push(`grid display is ${g.gridDisplay ?? 'missing'}`);
          }
          if (g.imgObjectFit !== expectedFit) {
            problems.push(
              `selected image object-fit is ${g.imgObjectFit ?? 'missing'}, expected ${expectedFit}`
            );
          }
          if (arm === 'pilot' && !pilotImageUrlsOk(collected.imageUrls)) {
            problems.push('pilot requested a selected original');
          }
          if (
            arm === 'control' &&
            !collected.imageUrls.some((url) => url.includes('/originals/'))
          ) {
            problems.push('control requested no staged original');
          }
          if (problems.length > 0) {
            fail(name, problems.join('; '));
          } else {
            pass(name);
          }
        } finally {
          await context.close();
        }
      }
      const pair = `store:${store.slug}:cross-arm-layout`;
      const left = surfaces.control?.geometry;
      const right = surfaces.pilot?.geometry;
      if (!left || !right || !left.selected || !right.selected) {
        fail(pair, 'missing geometry for cross-arm comparison');
      } else if (
        !boxesMatch(left.selected, right.selected) ||
        (left.heading &&
          right.heading &&
          !boxesMatch(left.heading, right.heading))
      ) {
        fail(pair, 'selected-slot boxes differ between arms');
      } else {
        pass(pair);
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
