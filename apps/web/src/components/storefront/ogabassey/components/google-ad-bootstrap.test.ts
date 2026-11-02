import { beforeEach, describe, expect, it, vi } from 'vitest';

const GPT_SCRIPT_SRC = 'https://securepubads.g.doubleclick.net/tag/js/gpt.js';
const mockWaitForLcpWindowEnd = vi.fn(() => Promise.resolve());

vi.mock('@/lib/posthog/wait-for-lcp', () => ({
  waitForLcpWindowEnd: () => mockWaitForLcpWindowEnd(),
}));

async function loadBootstrap() {
  vi.resetModules();
  return import('./google-ad-bootstrap');
}

function addLoadedGptScript() {
  const script = document.createElement('script');
  script.src = GPT_SCRIPT_SRC;
  script.dataset.baciLoaded = 'true';
  document.head.appendChild(script);
}

describe('google-ad-bootstrap', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockWaitForLcpWindowEnd.mockReset();
    mockWaitForLcpWindowEnd.mockImplementation(() => Promise.resolve());
    document.head.replaceChildren();
    delete (window as { googletag?: typeof window.googletag }).googletag;
  });

  it('configures GPT page settings through setConfig before enabling services', async () => {
    addLoadedGptScript();
    const pubAdsService = {
      collapseEmptyDivs: vi.fn(),
      enableSingleRequest: vi.fn(),
      setTargeting: vi.fn(),
    };
    const setConfig = vi.fn();
    const enableServices = vi.fn();

    window.googletag = {
      cmd: {
        push: (callback: () => void) => {
          callback();
          return 1;
        },
      },
      enableServices,
      pubads: vi.fn(() => pubAdsService),
      setConfig,
    } as unknown as typeof window.googletag;

    const { ensureGoogleAdManagerBoot } = await loadBootstrap();

    await ensureGoogleAdManagerBoot();

    expect(setConfig).toHaveBeenCalledWith({
      collapseDiv: 'ON_NO_FILL',
      singleRequest: true,
    });
    expect(setConfig).toHaveBeenCalledWith({
      targeting: {
        path: '/',
      },
    });
    expect(pubAdsService.enableSingleRequest).not.toHaveBeenCalled();
    expect(pubAdsService.collapseEmptyDivs).not.toHaveBeenCalled();
    expect(pubAdsService.setTargeting).not.toHaveBeenCalled();
    expect(enableServices).toHaveBeenCalledOnce();
  });

  it('updates path targeting through setConfig after services are configured', async () => {
    addLoadedGptScript();
    const pubAdsService = {
      collapseEmptyDivs: vi.fn(),
      enableSingleRequest: vi.fn(),
      setTargeting: vi.fn(),
    };
    const setConfig = vi.fn();

    window.googletag = {
      cmd: {
        push: (callback: () => void) => {
          callback();
          return 1;
        },
      },
      enableServices: vi.fn(),
      pubads: vi.fn(() => pubAdsService),
      setConfig,
    } as unknown as typeof window.googletag;

    const { ensureGoogleAdManagerBoot, setGoogleAdManagerPath } =
      await loadBootstrap();

    await ensureGoogleAdManagerBoot();
    setGoogleAdManagerPath('/ogabassey/quiz');

    expect(setConfig).toHaveBeenLastCalledWith({
      targeting: {
        path: '/ogabassey/quiz',
      },
    });
    expect(pubAdsService.setTargeting).not.toHaveBeenCalled();
  });

  it('falls back to legacy GPT settings when setConfig is unavailable', async () => {
    addLoadedGptScript();
    const pubAdsService = {
      collapseEmptyDivs: vi.fn(),
      enableSingleRequest: vi.fn(),
      setTargeting: vi.fn(),
    };

    window.googletag = {
      cmd: {
        push: (callback: () => void) => {
          callback();
          return 1;
        },
      },
      enableServices: vi.fn(),
      pubads: vi.fn(() => pubAdsService),
    } as unknown as typeof window.googletag;

    const { ensureGoogleAdManagerBoot } = await loadBootstrap();

    await ensureGoogleAdManagerBoot();

    expect(pubAdsService.enableSingleRequest).toHaveBeenCalledOnce();
    expect(pubAdsService.collapseEmptyDivs).toHaveBeenCalledOnce();
    expect(pubAdsService.setTargeting).toHaveBeenCalledWith('path', '/');
  });

  it('waits for the LCP window to end before injecting gpt.js into document.head', async () => {
    let resolveLcpGate: (() => void) | undefined;
    mockWaitForLcpWindowEnd.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveLcpGate = resolve;
        })
    );

    const { ensureGoogleAdManagerBoot } = await loadBootstrap();

    void ensureGoogleAdManagerBoot();

    expect(mockWaitForLcpWindowEnd).toHaveBeenCalledOnce();
    expect(
      document.head.querySelector(`script[src="${GPT_SCRIPT_SRC}"]`)
    ).toBeNull();

    resolveLcpGate?.();
    await Promise.resolve();

    expect(
      document.head.querySelector(`script[src="${GPT_SCRIPT_SRC}"]`)
    ).not.toBeNull();
  });
});
