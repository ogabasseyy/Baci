// Browser surface collection for the readiness gate: loads one store
// surface in Playwright, records console/request hygiene, image URLs,
// and the measured geometry the pure checks verdict. Split from the
// driver (merchant-image-pilot-readiness.mjs) under the repo line ceiling.

// No-AVIF emulation: remove AVIF candidates (typed <source> elements and
// AVIF preload links) from the served document, so a real browser must
// select the WebP fallback exactly as a no-AVIF browser would. Returns
// the stripped document plus the stripped count — a run that strips
// nothing proves no fallback and must fail, not pass vacuously.
export function stripAvifCandidates(html) {
  let stripped = 0;
  const body = String(html)
    .replace(/<source\b[^>]*type="image\/avif"[^>]*>/gi, () => {
      stripped += 1;
      return '';
    })
    .replace(/<link\b[^>]*type="image\/avif"[^>]*>/gi, () => {
      stripped += 1;
      return '';
    });
  return { body, stripped };
}

export async function collectSurface(page, url, surface, options = {}) {
  const consoleErrors = [];
  const failedRequests = [];
  const imageUrls = [];
  const origin = new URL(url).origin;
  const stripAvif = options.stripAvif === true;
  let strippedAvif = 0;
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text().slice(0, 200));
    }
  });
  page.on('pageerror', (error) => {
    consoleErrors.push(String(error).slice(0, 200));
  });
  // Parsed-origin comparison (not a string prefix): the lab is
  // self-contained, so any foreign response — even a 2xx font, CDN, or
  // analytics hit — contaminates timing and fails hygiene. Unparseable
  // URLs fail closed as foreign.
  const isForeign = (url) => {
    try {
      return new URL(url).origin !== origin;
    } catch {
      return true;
    }
  };
  const isAvifUrl = (value) => {
    try {
      return new URL(value).pathname.endsWith('.avif');
    } catch {
      return String(value ?? '')
        .split('?')[0]
        .endsWith('.avif');
    }
  };
  page.on('response', (response) => {
    const responseUrl = response.url();
    const foreign = isForeign(responseUrl);
    if (stripAvif && isAvifUrl(responseUrl)) {
      // Strip hole: no AVIF candidate survived to be requested, so any
      // AVIF response is an unlisted reference, not a fallback.
      failedRequests.push(
        `avif served despite no-avif ${responseUrl.slice(-80)}`
      );
    } else if (foreign) {
      failedRequests.push(
        `cross-origin ${response.status()} ${responseUrl.slice(-80)}`
      );
    } else if (response.status() >= 400) {
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
    const foreign = isForeign(requestUrl);
    failedRequests.push(
      `${foreign ? 'cross-origin ' : ''}requestfailed ${requestUrl.slice(-80)} (${request.failure()?.errorText ?? 'unknown'})`
    );
  });
  if (stripAvif) {
    await page.route(
      (routeUrl) => routeUrl.href === url,
      async (route) => {
        const response = await route.fetch();
        const stripped = stripAvifCandidates(await response.text());
        strippedAvif += stripped.stripped;
        await route.fulfill({ body: stripped.body, response });
      }
    );
  }
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
    // Selected w-descriptor width: with a w-descriptor srcset the browser
    // density-corrects naturalWidth (resource pixels / selected density),
    // so resolution verdicts need the physical resource width. Pilot mounts
    // render <picture> with the srcsets on child <source> elements (the
    // fallback <img> carries only src), so scan those too; plain-src
    // images (and x-descriptor sets) report null and keep natural pixels.
    const resourceWidthOf = (img) => {
      const srcsets = [img.getAttribute('srcset')];
      const parent = img.parentElement;
      if (parent && parent.tagName === 'PICTURE') {
        for (const source of parent.querySelectorAll('source[srcset]')) {
          srcsets.push(source.getAttribute('srcset'));
        }
      }
      for (const srcset of srcsets) {
        if (!srcset) {
          continue;
        }
        for (const candidate of srcset.split(',')) {
          const [url, descriptor] = candidate.trim().split(/\s+/);
          if (
            url &&
            descriptor?.endsWith('w') &&
            new URL(url, document.baseURI).href === img.currentSrc
          ) {
            const width = Number.parseInt(descriptor, 10);
            if (Number.isFinite(width) && width > 0) {
              return width;
            }
          }
        }
      }
      return null;
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
                box: rectOf(img),
                complete: img.complete,
                currentSrc: img.currentSrc,
                naturalHeight: img.naturalHeight,
                naturalWidth: img.naturalWidth,
                objectFit: getComputedStyle(img).objectFit,
                resourceWidth: resourceWidthOf(img),
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
      devicePixelRatio: window.devicePixelRatio,
      gridDisplay: grid ? getComputedStyle(grid).display : 'n/a-hero',
      heading: rectOf(heading),
      imgObjectFit: selectedImg
        ? getComputedStyle(selectedImg).objectFit
        : null,
      selected: rectOf(selected),
      selectedImg: selectedImg
        ? {
            box: rectOf(selectedImg),
            complete: selectedImg.complete,
            currentSrc: selectedImg.currentSrc,
            naturalHeight: selectedImg.naturalHeight,
            naturalWidth: selectedImg.naturalWidth,
            objectFit: getComputedStyle(selectedImg).objectFit,
            resourceWidth: resourceWidthOf(selectedImg),
          }
        : null,
      slots,
      stylesheetBytes: sheets.reduce(
        (sum, entry) => sum + (entry.encodedBodySize ?? 0),
        0
      ),
      stylesheetCount: sheets.length,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
    };
  }, surface);
  return { consoleErrors, failedRequests, geometry, imageUrls, strippedAvif };
}
