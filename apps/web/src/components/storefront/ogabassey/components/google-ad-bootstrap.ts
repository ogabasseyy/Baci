'use client';

import { waitForLcpWindowEnd } from '@/lib/posthog/wait-for-lcp';

const GPT_SCRIPT_SRC = 'https://securepubads.g.doubleclick.net/tag/js/gpt.js';

let googleAdManagerBootPromise: Promise<void> | null = null;
let servicesConfigured = false;
let targetedPath = '/';

export function ensureGoogleTag() {
  window.googletag =
    window.googletag ||
    ({
      cmd: [] as unknown as googletag.CommandArray,
    } as typeof window.googletag);

  return window.googletag;
}

function configurePageAdSettings(
  googletag: typeof window.googletag,
  pubAdsService: googletag.PubAdsService
) {
  if (typeof googletag.setConfig === 'function') {
    googletag.setConfig({
      collapseDiv: 'ON_NO_FILL',
      singleRequest: true,
    });
    return;
  }

  pubAdsService.enableSingleRequest();
  pubAdsService.collapseEmptyDivs();
}

function setPagePathTargeting(
  googletag: typeof window.googletag,
  pubAdsService: googletag.PubAdsService
) {
  if (typeof googletag.setConfig === 'function') {
    googletag.setConfig({
      targeting: {
        path: targetedPath,
      },
    });
    return;
  }

  pubAdsService.setTargeting('path', targetedPath);
}

function configureGoogleTagServices(resolve: () => void) {
  const googletag = ensureGoogleTag();

  googletag.cmd.push(() => {
    const pubAdsService = googletag.pubads();

    if (!servicesConfigured) {
      configurePageAdSettings(googletag, pubAdsService);
      googletag.enableServices();
      servicesConfigured = true;
    }

    setPagePathTargeting(googletag, pubAdsService);
    resolve();
  });
}

export function ensureGoogleAdManagerBoot() {
  if (typeof window === 'undefined') {
    return Promise.resolve();
  }

  const googletag = ensureGoogleTag();

  if (servicesConfigured && typeof googletag.pubads === 'function') {
    return Promise.resolve();
  }

  if (googleAdManagerBootPromise) {
    return googleAdManagerBootPromise;
  }

  googleAdManagerBootPromise = new Promise<void>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[src="${GPT_SCRIPT_SRC}"]`
    );

    const configureServices = () => configureGoogleTagServices(resolve);

    const attachExistingScript = (scriptEl: HTMLScriptElement) => {
      if (
        scriptEl.dataset.baciLoaded === 'true' ||
        typeof googletag.pubads === 'function'
      ) {
        configureServices();
        return;
      }

      scriptEl.addEventListener(
        'load',
        () => {
          scriptEl.dataset.baciLoaded = 'true';
          configureServices();
        },
        { once: true }
      );
      scriptEl.addEventListener(
        'error',
        () => reject(new Error('Failed to load Google Publisher Tag')),
        { once: true }
      );
    };

    if (existingScript) {
      attachExistingScript(existingScript);
      return;
    }

    void waitForLcpWindowEnd().then(() => {
      const scriptAfterLcp = document.querySelector<HTMLScriptElement>(
        `script[src="${GPT_SCRIPT_SRC}"]`
      );
      if (scriptAfterLcp) {
        attachExistingScript(scriptAfterLcp);
        return;
      }

      const script = document.createElement('script');
      script.src = GPT_SCRIPT_SRC;
      script.async = true;
      script.type = 'text/javascript';
      script.dataset.baciGpt = 'true';
      script.addEventListener(
        'load',
        () => {
          script.dataset.baciLoaded = 'true';
          configureServices();
        },
        { once: true }
      );
      script.addEventListener(
        'error',
        () => reject(new Error('Failed to load Google Publisher Tag')),
        { once: true }
      );
      document.head.appendChild(script);
    }).catch(reject);
  }).catch((error) => {
    googleAdManagerBootPromise = null;
    throw error;
  });

  return googleAdManagerBootPromise;
}

export function setGoogleAdManagerPath(pathname?: string | null) {
  if (typeof window === 'undefined') {
    return;
  }

  targetedPath = pathname || '/';

  const googletag = ensureGoogleTag();

  if (!servicesConfigured || typeof googletag.pubads !== 'function') {
    return;
  }

  googletag.cmd.push(() => {
    setPagePathTargeting(googletag, googletag.pubads());
  });
}
