// Effective-settings gate for pilot measurement outputs.
//
// Verifies the RECORDED effective settings of a Sitespeed/Browsertime HAR and
// a Lighthouse report against expectations — never the command-line labels.
// Fails closed on any mismatch or unreadable artifact, so a natively-shaped
// run can never be reported as throttled and a DPR-1.75 run never as DPR-2.
//
// Usage:
//   node merchant-image-pilot-settings.mjs --har=browsertime.har \
//     --screenshot=afterPageCompleteCheck.png [--lighthouse=report.json ...] \
//     --expect-iterations=1 --expect-connectivity=native \
//     --expect-chrome-major=154 --expect-viewport=375x667 --expect-dpr=3 \
//     [--cache-provenance=<runner-profile-token>] \
//     [--browser-version=<dotted-executable-build>]
// Add --lighthouse plus --expect-form-factor, --expect-throttling-method,
// --expect-lh-viewport, --expect-lh-dpr and --expect-cpu-slowdown to also
// verify a Lighthouse report. Exits 0 with a JSON report on stdout when
// every setting matches. Optional attestations remove unknowns: without
// --cache-provenance / --browser-version the report warns unknown instead
// of claiming cold-cache proof or executable identity.
import { readFile } from 'node:fs/promises';

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

function parseDimensions(value, name) {
  const match = /^(\d+)x(\d+)$/.exec(String(value ?? ''));
  if (!match) {
    throw new Error(`bad --${name}: ${value}`);
  }
  return { height: Number(match[2]), width: Number(match[1]) };
}

// PNG IHDR: width/height as uint32BE at bytes 16..23. No image deps.
export function pngDimensions(buffer) {
  if (
    buffer.length < 24 ||
    buffer.readUInt32BE(0) !== 0x89504e47 ||
    buffer.readUInt32BE(4) !== 0x0d0a1a0a
  ) {
    throw new Error('not a PNG');
  }
  return { height: buffer.readUInt32BE(20), width: buffer.readUInt32BE(16) };
}

export function harUserAgent(har) {
  const headers = har?.log?.entries?.[0]?.request?.headers ?? [];
  const found = headers.find(
    (header) => String(header.name).toLowerCase() === 'user-agent'
  );
  return found ? String(found.value) : null;
}

async function checkHar(args, pass, fail, warn, recorded) {
  let har;
  try {
    har = JSON.parse(await readFile(args.har, 'utf8'));
  } catch {
    fail('har.readable', `cannot parse ${args.har}`);
    return;
  }
  const pages = har?.log?.pages ?? [];
  const iterations = Number(args['expect-iterations']);
  if (pages.length !== iterations) {
    fail(
      'har.iterations',
      `recorded ${pages.length} runs, expected ${iterations}`
    );
  } else {
    pass('har.iterations');
  }
  const badConnectivity = pages.filter(
    (page) => page?._meta?.connectivity !== args['expect-connectivity']
  );
  if (badConnectivity.length > 0) {
    fail(
      'har.connectivity',
      `recorded ${pages.map((p) => p?._meta?.connectivity).join(',')}, expected ${args['expect-connectivity']}`
    );
  } else {
    pass('har.connectivity');
  }
  const ua = harUserAgent(har);
  recorded.browser = ua;
  // The request User-Agent is emulated configuration, not independent proof
  // of the browser executable version. The optional --browser-version
  // attestation (runner/CDP metadata) is recorded separately below.
  if (!ua?.includes(`Chrome/${args['expect-chrome-major']}.`)) {
    fail(
      'har.browser',
      `recorded UA does not show Chrome ${args['expect-chrome-major']} (emulated UA, not executable proof)`
    );
  } else {
    pass('har.browser');
  }
  const viewport = parseDimensions(args['expect-viewport'], 'expect-viewport');
  const dpr = Number(args['expect-dpr']);
  try {
    const png = pngDimensions(await readFile(args.screenshot));
    recorded.screenshot = `${png.width}x${png.height}`;
    // ±2px absorbs DPR rounding (667@3 → 2000); a wrong DPR or viewport
    // still misses by hundreds.
    if (
      Math.abs(png.width - viewport.width * dpr) > 2 ||
      Math.abs(png.height - viewport.height * dpr) > 2
    ) {
      fail(
        'har.geometry',
        `screenshot ${png.width}x${png.height} is not ${viewport.width}x${viewport.height}@${dpr}`
      );
    } else {
      pass('har.geometry');
    }
  } catch {
    fail('har.geometry', `cannot read ${args.screenshot}`);
  }
  // Cold cache means NO RECORDED cache hit: a revalidation miss (304) or
  // any runner-recorded cache path (disk, prefetch, service worker). Cached
  // resources can carry HTTP 200, so status alone never proves cold. Plain
  // zero-byte entries (204s, data URLs) carry none of these signals and are
  // not classified as cache. Absence of recorded hits plus affirmative
  // runner provenance (har.cache-provenance) is the full claim.
  const cached = (har?.log?.entries ?? []).filter((entry) => {
    const response = entry?.response ?? {};
    return (
      response.status === 304 ||
      response.fromDiskCache === true ||
      response.fromPrefetchCache === true ||
      response.fromServiceWorker === true
    );
  });
  if (cached.length > 0) {
    fail(
      'har.cold-cache',
      `${cached.length} recorded cache hits (304/disk/prefetch/service-worker)`
    );
  } else {
    pass('har.cold-cache');
  }
  if (args['cache-provenance'] === undefined) {
    warn(
      'har.cache-provenance',
      'unknown (no runner profile/reset provenance supplied; HAR shows no recorded hits)'
    );
  } else {
    recorded.cacheProvenance = args['cache-provenance'];
    pass('har.cache-provenance');
  }
  if (args['browser-version'] === undefined) {
    warn(
      'har.browser-version',
      'unknown (no runner/CDP executable version supplied; UA above is emulated)'
    );
  } else {
    const version = args['browser-version'];
    recorded.browserExecutable = version;
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(version)) {
      fail(
        'har.browser-version',
        `attested version "${version}" is not a dotted browser build`
      );
    } else if (!version.startsWith(`${args['expect-chrome-major']}.`)) {
      fail(
        'har.browser-version',
        `attested executable ${version} does not match Chrome ${args['expect-chrome-major']}`
      );
    } else {
      pass('har.browser-version');
    }
  }
}

async function checkLighthouse(args, pass, fail, recorded) {
  let report;
  try {
    report = JSON.parse(await readFile(args.lighthouse, 'utf8'));
  } catch {
    fail('lighthouse.readable', `cannot parse ${args.lighthouse}`);
    return;
  }
  const settings = report?.configSettings ?? {};
  const emulation = settings.screenEmulation ?? {};
  const viewport = parseDimensions(
    args['expect-lh-viewport'],
    'expect-lh-viewport'
  );
  const scaled = [
    ['lighthouse.form-factor', settings.formFactor, args['expect-form-factor']],
    [
      'lighthouse.throttling-method',
      settings.throttlingMethod,
      args['expect-throttling-method'],
    ],
    ['lighthouse.viewport-width', emulation.width, viewport.width],
    ['lighthouse.viewport-height', emulation.height, viewport.height],
    [
      'lighthouse.dpr',
      emulation.deviceScaleFactor,
      Number(args['expect-lh-dpr']),
    ],
    [
      'lighthouse.cpu-slowdown',
      settings.throttling?.cpuSlowdownMultiplier,
      Number(args['expect-cpu-slowdown']),
    ],
  ];
  for (const [name, actual, expected] of scaled) {
    if (actual !== expected) {
      fail(name, `recorded ${actual}, expected ${expected}`);
    } else {
      pass(name);
    }
  }
  recorded.lighthouse = {
    benchmarkIndex: report?.environment?.benchmarkIndex ?? null,
    throttling: settings.throttling ?? null,
  };
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const failures = [];
  const checks = [];
  const recorded = {};
  // Unknowns, not failures: unavailable runner provenance is reported as
  // unknown rather than claimed as proof or failed as a defect.
  const warnings = [];
  const pass = (name) => checks.push({ name, ok: true });
  const fail = (name, detail) => {
    checks.push({ name, ok: false });
    failures.push(`${name}: ${detail}`);
  };
  const warn = (name, detail) => {
    warnings.push(`${name}: ${detail}`);
  };
  const required = [
    'har',
    'screenshot',
    'expect-iterations',
    'expect-connectivity',
    'expect-chrome-major',
    'expect-viewport',
    'expect-dpr',
  ];
  const lhRequired = [
    'lighthouse',
    'expect-form-factor',
    'expect-throttling-method',
    'expect-lh-viewport',
    'expect-lh-dpr',
    'expect-cpu-slowdown',
  ];
  const missing = required.filter((key) => args[key] === undefined);
  if (missing.length > 0) {
    fail('usage', `missing ${missing.map((key) => `--${key}`).join(', ')}`);
    return { checks, failures, ok: false, recorded, warnings };
  }
  try {
    await checkHar(args, pass, fail, warn, recorded);
    // --lighthouse is optional: the Sitespeed step runs before Lighthouse.
    if (args.lighthouse === undefined) {
      checks.push({ name: 'lighthouse.skipped', ok: true });
    } else {
      const lhMissing = lhRequired.filter((key) => args[key] === undefined);
      if (lhMissing.length > 0) {
        fail(
          'usage',
          `missing ${lhMissing.map((key) => `--${key}`).join(', ')}`
        );
      } else {
        await checkLighthouse(args, pass, fail, recorded);
      }
    }
  } catch (error) {
    fail('settings.crashed', String(error).slice(0, 200));
  }
  return {
    checks,
    failures,
    ok: failures.length === 0,
    recorded,
    warnings,
  };
}

const isMain = process.argv[1]?.endsWith('merchant-image-pilot-settings.mjs');
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
          failures: [`settings crashed: ${String(error).slice(0, 300)}`],
          ok: false,
          recorded: {},
          warnings: [],
        })
      );
      process.exitCode = 1;
    }
  );
}
