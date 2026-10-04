// Browser surface collection for the readiness gate: loads one store
// surface in Playwright, records console/request hygiene, image URLs,
// and the measured geometry the pure checks verdict. Split from the
// driver (merchant-image-pilot-readiness.mjs) under the repo line ceiling.

export async function collectSurface(page, url, surface) {
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
    const foreign = !responseUrl.startsWith(origin);
    if (response.status() >= 400) {
      // Self-contained lab pages: same- and cross-origin failures fail hygiene.
      failedRequests.push(
        `${foreign ? 'cross-origin ' : ''}${response.status()} ${responseUrl.slice(-80)}`
      );
    }
    const contentType = response.headers()['content-type'] ?? '';
    if (contentType.startsWith('image/')) {
      imageUrls.push(responseUrl);
    }
  });
  // Network-level failures (DNS, reset, aborted) never produce a response.
  page.on('requestfailed', (request) => {
    const requestUrl = request.url();
    const foreign = !requestUrl.startsWith(origin);
    failedRequests.push(
      `${foreign ? 'cross-origin ' : ''}requestfailed ${requestUrl.slice(-80)} (${request.failure()?.errorText ?? 'unknown'})`
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
    // Selected w-descriptor width: with a w-descriptor srcset the browser
    // density-corrects naturalWidth (resource pixels / selected density),
    // so resolution verdicts need the physical resource width. Plain-src
    // images (and x-descriptor sets) report null and keep natural pixels.
    const resourceWidthOf = (img) => {
      const srcset = img.getAttribute('srcset');
      if (!srcset) {
        return null;
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
  return { consoleErrors, failedRequests, geometry, imageUrls };
}
