// Lighthouse-report checks for the pilot effective-settings gate.
//
// Verifies the RECORDED configSettings of a Lighthouse report against
// expectations — never the command-line labels. Fails closed on any
// mismatch or unreadable artifact.
import { readFile } from 'node:fs/promises';
import { parseDimensions } from './merchant-image-pilot-settings-helpers.mjs';

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
