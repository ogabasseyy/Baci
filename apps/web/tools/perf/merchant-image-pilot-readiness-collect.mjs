// Browser surface collection for the readiness gate: loads one store
// surface in Playwright, records console/request hygiene, image URLs,
// and the measured geometry the pure checks verdict. Split from the
// driver (merchant-image-pilot-readiness.mjs) under the repo line ceiling.
import { join, resolve, sep } from 'node:path';
import sharp from 'sharp';
import { orientedDimensions } from '../../../../infra/cdn-transformer/pilot/encode-worker.mjs';

// Control-arm physical width: the global custom loader appends inert
// ?w/?q params to the unchanged staged original, so a collected
// w-descriptor is a REQUESTED label, not the resource's physical width
// (the served-descriptor gate recognizes the same distinction). Derive
// it from the decoded staged bytes instead; null fails the surface
// closed via controlBytesUnverified.
async function controlPhysicalWidth(currentSrc, publicDir) {
  let pathname;
  try {
    pathname = new URL(currentSrc).pathname;
  } catch {
    return null;
  }
  if (!pathname.startsWith('/__pilot/')) {
    return null;
  }
  const root = resolve(publicDir);
  const target = resolve(join(root, pathname));
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    return null;
  }
  try {
    const meta = await sharp(target).metadata();
    const oriented = orientedDimensions(meta);
    return Number.isFinite(oriented.width) && oriented.width > 0
      ? oriented.width
      : null;
  } catch {
    return null;
  }
}

export async function collectSurface(page, url, surface, options = {}) {
  const consoleErrors = [];
  const failedRequests = [];
  const imageUrls = [];
  const origin = new URL(url).origin;
  const disableAvif = options.disableAvif === true;
  let avifDisabled = false;
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
  // Playwright request resource type, defensively: older drivers and
  // test doubles may not implement response.request().
  const isImageRequest = (response) => {
    try {
      return response.request().resourceType() === 'image';
    } catch {
      return false;
    }
  };
  page.on('response', (response) => {
    const responseUrl = response.url();
    const foreign = isForeign(responseUrl);
    if (disableAvif && isAvifUrl(responseUrl)) {
      // Unsupported AVIF must not be fetched by this fallback profile.
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
    } else if (
      response.status() >= 200 &&
      response.status() < 300 &&
      isImageRequest(response)
    ) {
      // An <img> request answered 2xx with a non-image body (HTML
      // fallback page, error document, empty 204) renders a broken card
      // but is neither a failed request nor an image URL above — flag
      // it so a missing filler or sibling image cannot pass hygiene
      // silently. 2xx only: redirects and 304s legitimately carry no
      // image body. Every lab <img> must render, so no 2xx carve-out:
      // a 204 tracking pixel has no place on a measurement page.
      failedRequests.push(
        `non-image ${response.status()} ${responseUrl.slice(-80)}`
      );
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
  if (disableAvif) {
    // Preserve the complete server/client hydration tree. Chromium changes
    // format support, not HTML; unsupported CDP commands fail before navigation.
    const session = await page.context().newCDPSession(page);
    await session.send('Emulation.setDisabledImageTypes', {
      imageTypes: ['avif'],
    });
    avifDisabled = true;
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
      avifCandidates: document.querySelectorAll('source[type="image/avif"]')
        .length,
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
  if (options.arm === 'control') {
    // The descriptor lie exists only where a descriptor was collected:
    // plain-src control images keep natural pixels (true without
    // srcset density correction). Decoded width replaces the label;
    // height still follows the natural aspect, which density
    // correction preserves.
    const images = [
      geometry.selectedImg,
      ...(geometry.slots ?? []).map((slot) => slot.img),
    ];
    for (const image of images) {
      if (
        !image ||
        !Number.isFinite(image.resourceWidth) ||
        image.resourceWidth <= 0
      ) {
        continue;
      }
      const physical =
        options.publicDir === undefined
          ? null
          : await controlPhysicalWidth(image.currentSrc, options.publicDir);
      if (physical === null) {
        image.controlBytesUnverified = true;
        image.resourceWidth = null;
      } else {
        image.resourceWidth = physical;
      }
    }
  }
  return { avifDisabled, consoleErrors, failedRequests, geometry, imageUrls };
}
