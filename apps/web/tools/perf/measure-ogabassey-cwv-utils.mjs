const BACI_CWV_FETCH_USER_AGENT = 'Baci-CWV-measurement/1.0';
const DEBUGBEAR_API_USER_AGENT = 'Baci-CWV-debugbear-api/1.0';

const DEFAULT_OGABASSEY_CWV_TARGETS = Object.freeze({
  home: 'https://ogabassey.com/',
  pdp: 'https://ogabassey.com/gaming-laptops/dell-alienware-m18-r3-rtx-5080',
  blog: 'https://ogabassey.com/blog',
});

function buildDebugBearHeaders(apiKey) {
  return {
    'content-type': 'application/json',
    'user-agent': DEBUGBEAR_API_USER_AGENT,
    'x-api-key': apiKey,
  };
}

function normalizeDebugBearProjects(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.projects)) return body.projects;
  if (Array.isArray(body?.items)) return body.items;
  if (Array.isArray(body?.result)) return body.result;
  return [];
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function getProjectPages(project) {
  return [
    ...asArray(project?.pages),
    ...asArray(project?.pageList),
    ...asArray(project?.checks),
  ];
}

function getPageUrl(page) {
  return page?.url ?? page?.targetUrl ?? page?.pageUrl ?? page?.name ?? null;
}

function pageMatchesDevice(page, requestedDevice) {
  const text = [
    page?.deviceName,
    page?.formFactor,
    page?.device?.formFactor,
    page?.device?.name,
    page?.testProfile?.device,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (!text) return true;

  const requested = `${requestedDevice || ''}`.toLowerCase();
  if (requested.includes('desktop')) {
    return text.includes('desktop');
  }
  if (requested.includes('mobile') || requested.includes('phone')) {
    return text.includes('mobile') || text.includes('phone');
  }
  return text.includes(requested);
}

function normalizeUrlForMatch(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    url.search = '';
    if (url.pathname !== '/') {
      url.pathname = url.pathname.replace(/\/+$/, '');
    }
    return url.toString();
  } catch {
    return '';
  }
}

function getOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

function findDebugBearProjectIdForUrl(
  projects,
  targetUrl,
  { deviceName = 'Mobile' } = {}
) {
  const target = normalizeUrlForMatch(targetUrl);
  const targetOrigin = getOrigin(targetUrl);
  if (!target || !targetOrigin) return null;

  for (const project of projects) {
    for (const page of getProjectPages(project)) {
      if (
        pageMatchesDevice(page, deviceName) &&
        normalizeUrlForMatch(getPageUrl(page)) === target
      ) {
        const projectId = project.id ?? project.projectId;
        if (projectId != null) return projectId;
      }
    }
  }

  for (const project of projects) {
    for (const page of getProjectPages(project)) {
      if (
        pageMatchesDevice(page, deviceName) &&
        getOrigin(getPageUrl(page)) === targetOrigin
      ) {
        const projectId = project.id ?? project.projectId;
        if (projectId != null) return projectId;
      }
    }
  }

  return null;
}

function targetUrl(value, fallback) {
  const trimmed = `${value ?? ''}`.trim();
  return trimmed || fallback;
}

function buildOgaBasseyCwvTargets({
  blogPostUrl,
  blogUrl = DEFAULT_OGABASSEY_CWV_TARGETS.blog,
  homeUrl = DEFAULT_OGABASSEY_CWV_TARGETS.home,
  pdpUrl = DEFAULT_OGABASSEY_CWV_TARGETS.pdp,
} = {}) {
  const targets = [
    {
      label: 'home',
      url: targetUrl(homeUrl, DEFAULT_OGABASSEY_CWV_TARGETS.home),
    },
    {
      label: 'pdp',
      url: targetUrl(pdpUrl, DEFAULT_OGABASSEY_CWV_TARGETS.pdp),
    },
    {
      label: 'blog-index',
      url: targetUrl(blogUrl, DEFAULT_OGABASSEY_CWV_TARGETS.blog),
    },
  ];

  if (blogPostUrl) {
    targets.push({ label: 'blog-post-latest', url: blogPostUrl });
  }

  return targets;
}

function normalizeTargetLabel(value) {
  const normalized = `${value ?? ''}`.trim().toLowerCase();
  if (normalized === 'pdp' || normalized === 'pdp-lcp') return 'pdp';
  if (normalized === 'pdp-dell') return 'pdp';
  if (normalized === 'blog') return 'blog-index';
  if (normalized === 'latest-blog-post') return 'blog-post-latest';
  return normalized;
}

function filterOgaBasseyCwvTargets(targets, requestedLabels) {
  const labels = `${requestedLabels ?? ''}`
    .split(',')
    .map(normalizeTargetLabel)
    .filter(Boolean);
  if (!labels.length) return targets;

  const labelSet = new Set(labels);
  return targets.filter((target) => labelSet.has(target.label));
}

function applyPdpCanonicalResolution({
  pdpResolution,
  pdpTarget,
  targetResolutionFailures,
  targets,
}) {
  if (!pdpTarget || !pdpResolution) return targets;

  if (pdpResolution.failure) {
    targetResolutionFailures.push(pdpResolution.failure);
    return targets;
  }

  pdpTarget.url = pdpResolution.url;
  return targets;
}

function logOgaBasseyCwvCompletion(
  auditId,
  outputDir,
  shouldPrintLegacyPdpJson
) {
  const finalLog = shouldPrintLegacyPdpJson ? console.error : console.log;
  finalLog(`Saved CWV audit artifacts to ${outputDir}`);
  finalLog(`Audit id: ${auditId}`);
}

function buildLegacyPdpLcpJson(summary) {
  return {
    cls: summary.cls ?? null,
    device: summary.device ?? summary.strategy ?? null,
    fcpMs: summary.fcpMs ?? null,
    lcpMs: summary.lcpMs ?? null,
    quickTestId: summary.quickTestId ?? null,
    region: summary.region ?? null,
    resultUrl: summary.resultUrl ?? null,
    tbtMs: summary.tbtMs ?? null,
    url: summary.url ?? summary.finalUrl ?? null,
  };
}

function buildOgaBasseyCwvConfigurationFailures({
  debugBearApiKey,
  debugBearRequiresConfiguredDeviceUserAgent = false,
  hasConfiguredDebugBearDeviceUserAgent = false,
  hasDiscoverableDebugBearProject,
  isDebugBearDisabled = false,
  isDebugBearExplicitlyEnabled,
  shouldRunDebugBear,
  shouldRunPsi,
  targetResolutionFailures = [],
  targets = [],
} = {}) {
  const failures = [...targetResolutionFailures];

  if (isDebugBearExplicitlyEnabled && !debugBearApiKey) {
    failures.push({
      label: 'debugbear',
      message:
        'OGABASSEY_CWV_DEBUGBEAR explicitly enabled DebugBear, but DEBUGBEAR_API_KEY/DEBUGBEAR_ADMIN_API_KEY is not configured.',
      source: 'configuration',
    });
  }

  if (isDebugBearExplicitlyEnabled && !hasDiscoverableDebugBearProject) {
    failures.push({
      label: 'debugbear-projects',
      message:
        'DebugBear requires DEBUGBEAR_PROJECT_ID, DEBUGBEAR_ADMIN_API_KEY, or an admin key in DEBUGBEAR_API_KEY before scheduling quick tests.',
      source: 'configuration',
    });
  }

  if (
    !isDebugBearDisabled &&
    isDebugBearExplicitlyEnabled &&
    debugBearRequiresConfiguredDeviceUserAgent &&
    !hasConfiguredDebugBearDeviceUserAgent
  ) {
    failures.push({
      label: 'debugbear-device-user-agent',
      message:
        'DebugBear Quick Tests cannot set a browser user-agent per request. Set DEBUGBEAR_DEVICE to a DebugBear device configured with Baci-CWV-measurement/1.0, or set OGABASSEY_CWV_REQUIRE_DEBUGBEAR_DEVICE_UA=0 to opt out.',
      source: 'configuration',
    });
  }

  if (!shouldRunPsi && !shouldRunDebugBear) {
    failures.push({
      label: 'measurement',
      message:
        'No CWV provider is scheduled. Enable PageSpeed Insights or configure DebugBear with an API key and project discovery.',
      source: 'configuration',
    });
  }

  if (targets.length === 0) {
    failures.push({
      label: 'targets',
      message:
        'No CWV targets matched OGABASSEY_CWV_TARGET_LABELS. Use home, pdp, blog-index, or blog-post-latest.',
      source: 'configuration',
    });
  }

  return failures;
}

export const ogabasseyCwvUtils = Object.freeze({
  BACI_CWV_FETCH_USER_AGENT,
  DEBUGBEAR_API_USER_AGENT,
  DEFAULT_OGABASSEY_CWV_TARGETS,
  buildDebugBearHeaders,
  normalizeDebugBearProjects,
  normalizeUrlForMatch,
  findDebugBearProjectIdForUrl,
  buildOgaBasseyCwvTargets,
  filterOgaBasseyCwvTargets,
  applyPdpCanonicalResolution,
  logOgaBasseyCwvCompletion,
  buildLegacyPdpLcpJson,
  buildOgaBasseyCwvConfigurationFailures,
});
