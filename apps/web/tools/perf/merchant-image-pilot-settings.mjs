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
//     --screenshot-provenance=<runner-capture-artifact.json> \
//     [--cache-provenance=<runner-reset-artifact.json>] \
//     [--browser-version=<dotted-executable-build>]
// Add --lighthouse plus --expect-form-factor, --expect-throttling-method,
// --expect-lh-viewport, --expect-lh-dpr and --expect-cpu-slowdown to also
// verify a Lighthouse report, plus the method's network expectations
// (--expect-rtt-ms/--expect-throughput-kbps for simulate,
// --expect-request-latency-ms/--expect-download-kbps/--expect-upload-kbps
// for devtools). Exits 0 with a JSON report on stdout when
// every setting matches. --cache-provenance is REQUIRED for the cold-cache
// claim: converters can omit cache hits entirely, so zero recorded hits alone never proves cold; --browser-version stays optional.
// --cache-provenance takes a PATH to a runner profile-reset artifact
// (event/freshProfile/profileDir/resetAt/runId/tool), bound <=1h before
// the run and to the navigation via the single-use _meta.runId.

import { checkHar } from './merchant-image-pilot-settings-har.mjs';
import { parseArgs } from './merchant-image-pilot-settings-helpers.mjs';
import { checkLighthouse } from './merchant-image-pilot-settings-lighthouse.mjs';

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
        // Method-relevant network expectations: the method alone cannot
        // match evidence, so each comparable method requires its own
        // explicit network flags.
        const networkRequired =
          args['expect-throttling-method'] === 'devtools'
            ? [
                'expect-request-latency-ms',
                'expect-download-kbps',
                'expect-upload-kbps',
              ]
            : args['expect-throttling-method'] === 'simulate'
              ? ['expect-rtt-ms', 'expect-throughput-kbps']
              : [];
        const networkMissing = networkRequired.filter(
          (key) => args[key] === undefined
        );
        if (networkMissing.length > 0) {
          fail(
            'usage',
            `missing ${networkMissing.map((key) => `--${key}`).join(', ')}`
          );
        } else {
          await checkLighthouse(args, pass, fail, recorded);
        }
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
