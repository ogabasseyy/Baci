// Frozen-sample pin stage for the offline gate: expectations derive from
// the supplied inventory, so a silently reduced sample (deleted record
// or merchant) would otherwise report ok:true on weaker evidence. The
// operator always pins the planned merchant/asset/slot matrix
// (merchant-image-pilot-frozen-sample.json for the handoff sample); any
// shrinkage or growth fails before expectations derive. There is no
// unpinned mode: an omitted pin fails instead of certifying an unknown
// sample. Extracted from preflight-offline.mjs under the 300-line ceiling.
import {
  fail,
  pass,
  readJson,
} from './merchant-image-pilot-preflight-shared.mjs';

export async function checkSamplePin({
  checks,
  expectSample,
  failures,
  inventory,
}) {
  if (expectSample === undefined || expectSample === null) {
    fail(
      checks,
      failures,
      'sample-pin',
      'sample pin is required: pass --expect-sample <frozen-keys.json> so a reduced inventory cannot report ok'
    );
    return false;
  }
  let expected;
  try {
    expected = await readJson(expectSample);
  } catch (error) {
    fail(
      checks,
      failures,
      'sample-pin',
      `cannot read expect-sample (${error.message})`
    );
    return false;
  }
  if (
    !Array.isArray(expected) ||
    expected.length === 0 ||
    !expected.every((entry) => typeof entry === 'string')
  ) {
    fail(
      checks,
      failures,
      'sample-pin',
      'expect-sample must be a non-empty array of merchant/asset/slot keys'
    );
    return false;
  }
  const frozen = new Set(expected);
  const actual = new Set(
    inventory.map(
      (record) => `${record.merchantId}/${record.assetId}/${record.slot}`
    )
  );
  const missing = [...frozen].filter((key) => !actual.has(key));
  const extra = [...actual].filter((key) => !frozen.has(key));
  if (missing.length > 0 || extra.length > 0) {
    const details = [
      ...(missing.length > 0
        ? [`sample bindings missing from inventory: ${missing.join(', ')}`]
        : []),
      ...(extra.length > 0
        ? [`inventory bindings outside the frozen sample: ${extra.join(', ')}`]
        : []),
    ];
    fail(checks, failures, 'sample-pin', details.join('; '));
    return false;
  }
  pass(checks, 'sample-pin');
  return true;
}
