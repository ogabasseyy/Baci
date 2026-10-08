// Lighthouse-report checks for the pilot effective-settings gate.
//
// Verifies the RECORDED configSettings of a Lighthouse report against
// expectations — never the command-line labels. Fails closed on any
// mismatch or unreadable artifact.
import { readFile } from 'node:fs/promises';
import {
  parseDimensions,
  parseNonNegativeNumber,
  parsePositiveNumber,
} from './merchant-image-pilot-settings-helpers.mjs';

// Method-relevant network fields: the throttling method and CPU
// multiplier alone cannot match evidence — two simulate runs with
// different RTT/throughput, or two devtools runs with different
// latency/download/upload profiles, would certify as matched. Each
// method compares its own recorded fields against explicit flags.
const NETWORK_FIELDS = {
  devtools: [
    [
      'lighthouse.throttling-request-latency-ms',
      'requestLatencyMs',
      'expect-request-latency-ms',
      parseNonNegativeNumber,
    ],
    [
      'lighthouse.throttling-download-kbps',
      'downloadThroughputKbps',
      'expect-download-kbps',
      parsePositiveNumber,
    ],
    [
      'lighthouse.throttling-upload-kbps',
      'uploadThroughputKbps',
      'expect-upload-kbps',
      parsePositiveNumber,
    ],
  ],
  simulate: [
    [
      'lighthouse.throttling-rtt-ms',
      'rttMs',
      'expect-rtt-ms',
      parseNonNegativeNumber,
    ],
    [
      'lighthouse.throttling-throughput-kbps',
      'throughputKbps',
      'expect-throughput-kbps',
      parsePositiveNumber,
    ],
  ],
};

export async function checkLighthouse(args, pass, fail, recorded) {
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
  // Network profile match, driven by the EXPECTED method (never the
  // recorded one — expectations come from flags, not the artifact).
  const networkFields = NETWORK_FIELDS[args['expect-throttling-method']];
  if (!networkFields) {
    fail(
      'lighthouse.throttling-network',
      `method "${args['expect-throttling-method']}" records no comparable network profile; matched evidence requires simulate or devtools expectations`
    );
  } else {
    const throttling = settings.throttling ?? {};
    for (const [name, field, flag, parse] of networkFields) {
      const expected = parse(args[flag], flag);
      const actual = throttling[field];
      if (actual !== expected) {
        fail(name, `recorded ${actual}, expected ${expected}`);
      } else {
        pass(name);
      }
    }
  }
  // Dormant geometry never certifies a viewport: Lighthouse applies
  // screenEmulation only when `disabled` is false, and `formFactor`
  // does not prove emulation was active (it only scores the run).
  // `{disabled: true}` means emulation was avoided (external Puppeteer
  // emulation or a real mobile device), so the width/height/DPR fields
  // above describe nothing Lighthouse did.
  if (emulation.disabled !== false) {
    fail(
      'lighthouse.screen-emulation',
      `screen emulation not applied (disabled: ${emulation.disabled}); recorded geometry is dormant`
    );
  } else {
    pass('lighthouse.screen-emulation');
  }
  const expectedMobile = args['expect-form-factor'] === 'mobile';
  if (emulation.mobile !== expectedMobile) {
    fail(
      'lighthouse.emulation-mode',
      `recorded mobile ${emulation.mobile}, expected ${expectedMobile} for form factor ${args['expect-form-factor']}`
    );
  } else {
    pass('lighthouse.emulation-mode');
  }
  recorded.lighthouse = {
    benchmarkIndex: report?.environment?.benchmarkIndex ?? null,
    screenEmulation: {
      disabled: emulation.disabled ?? null,
      mobile: emulation.mobile ?? null,
    },
    throttling: settings.throttling ?? null,
  };
}
