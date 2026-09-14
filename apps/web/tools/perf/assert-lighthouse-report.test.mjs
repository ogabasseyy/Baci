import assert from 'node:assert/strict';
import test from 'node:test';
import { assertLighthouseReport } from './assert-lighthouse-report.mjs';

function report() {
  return {
    audits: {
      'largest-contentful-paint': { numericValue: 1500 },
      'cumulative-layout-shift': { numericValue: 0 },
      'network-requests': {
        details: { items: [{ resourceType: 'Image', statusCode: 200 }] },
      },
      'screenshot-thumbnails': { details: { items: [{ data: 'sample' }] } },
    },
  };
}

test('accepts a complete report without claiming visual correctness', () => {
  assert.equal(assertLighthouseReport(report()), true);
});
test('rejects a broken image even when other metrics look good', () => {
  const input = report();
  input.audits['network-requests'].details.items[0].statusCode = -1;
  assert.throws(() => assertLighthouseReport(input), /failed Image/);
});
test('rejects a failed font', () => {
  const input = report();
  input.audits['network-requests'].details.items = [
    { resourceType: 'Font', statusCode: 404 },
  ];
  assert.throws(() => assertLighthouseReport(input), /failed Font/);
});
test('rejects absent metrics, network evidence and screenshots', () => {
  for (const key of Object.keys(report().audits)) {
    const input = report();
    delete input.audits[key];
    assert.throws(() => assertLighthouseReport(input));
  }
});
test('rejects navigation failures and invalid LCP', () => {
  assert.throws(() =>
    assertLighthouseReport({
      ...report(),
      runtimeError: { code: 'NO_NAVSTART' },
    })
  );
  for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const input = report();
    input.audits['largest-contentful-paint'].numericValue = value;
    assert.throws(() => assertLighthouseReport(input));
  }
});
