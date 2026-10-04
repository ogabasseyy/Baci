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
//     [--cache-provenance=<runner-reset-artifact.json>] \
//     [--browser-version=<dotted-executable-build>]
// Add --lighthouse plus --expect-form-factor, --expect-throttling-method,
// --expect-lh-viewport, --expect-lh-dpr and --expect-cpu-slowdown to also
// verify a Lighthouse report. Exits 0 with a JSON report on stdout when
// every setting matches. --cache-provenance is REQUIRED for the cold-cache
// claim: converters can omit cache hits entirely, so zero recorded hits alone never proves cold; --browser-version stays optional.
// --cache-provenance takes a PATH to a runner profile-reset artifact
// (event/freshProfile/profileDir/resetAt/tool), bound <=1h before the run.
import { readFile } from 'node:fs/promises';
import {
  findCacheHits,
  harUserAgent,
  parseArgs,
  parseDimensions,
  parsePositiveInteger,
  parsePositiveNumber,
  pngDimensions,
  verifyBrowserVersion,
  verifyCacheProvenance,
  verifyHarConnectivity,
  verifyHarIterations,
} from './merchant-image-pilot-settings-helpers.mjs';

async function checkHar(args, pass, fail, warn, recorded) {
  let har;
  try {
    har = JSON.parse(await readFile(args.har, 'utf8'));
  } catch {
    fail('har.readable', `cannot parse ${args.har}`);
    return;
  }
  const pages = har?.log?.pages ?? [];
  const iterations = parsePositiveInteger(
    args['expect-iterations'],
    'expect-iterations'
  );
  const iterationsCheck = verifyHarIterations(pages, iterations);
  if (!iterationsCheck.ok) {
    fail('har.iterations', iterationsCheck.error);
  } else {
    pass('har.iterations');
  }
  const connectivityCheck = verifyHarConnectivity(
    pages,
    args['expect-connectivity']
  );
  if (!connectivityCheck.ok) {
    fail('har.connectivity', connectivityCheck.error);
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
  const dpr = parsePositiveNumber(args['expect-dpr'], 'expect-dpr');
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
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    fail('har.geometry', `cannot use ${args.screenshot} (${why})`);
  }
  // Absence of recorded hits is necessary but NOT sufficient: converters
  // such as chrome-har drop disk-cached resources by default, so a warm run
  // can present zero entries. The cold claim additionally requires a
  // validated runner artifact (--cache-provenance): a bare caller string
  // would let any warm run certify itself cold.
  const cacheHits = findCacheHits(har);
  const provenancePath = args['cache-provenance'];
  let provenanceError = null;
  if (provenancePath !== undefined) {
    const text = await readFile(provenancePath, 'utf8').catch(() => null);
    const provenance = verifyCacheProvenance(text, pages, provenancePath);
    if (!provenance.ok) {
      provenanceError = provenance.error;
    } else {
      recorded.cacheProvenance = provenance.summary;
    }
  }
  if (cacheHits.length > 0) {
    fail(
      'har.cold-cache',
      `${cacheHits.length} recorded cache hits (304/disk/prefetch/service-worker/beforeRequest)`
    );
  } else if (provenanceError) {
    fail('har.cold-cache', provenanceError);
  } else if (args['cache-provenance'] === undefined) {
    fail(
      'har.cold-cache',
      'no recorded hits, but no cache-reset provenance: absence cannot prove cold (converters may omit cached resources)'
    );
  } else {
    pass('har.cold-cache');
  }
  if (args['cache-provenance'] === undefined) {
    warn(
      'har.cache-provenance',
      'unknown (no runner profile/reset provenance supplied)'
    );
  } else if (provenanceError) {
    fail('har.cache-provenance', provenanceError);
  } else {
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
    const checked = verifyBrowserVersion(version, args['expect-chrome-major']);
    if (!checked.ok) {
      fail('har.browser-version', checked.error);
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
  const warn = (name, detail) => warnings.push(`${name}: ${detail}`);
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    fail('usage', error instanceof Error ? error.message : String(error));
    return { checks, failures, ok: false, recorded, warnings };
  }
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
