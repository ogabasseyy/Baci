// Offline gate orchestration: recipe pin, inventory/acceptance validation,
// then per-binding stages (input, acceptance, manifest, tiers, staged).
// Bindings that pass every stage land in `accepted` for the served gate.
import {
  MAX_JOBS,
  RECIPE_ID,
} from '../../../../infra/cdn-transformer/pilot/constants.mjs';
import {
  checkBindingAcceptance,
  checkBindingInput,
} from './merchant-image-pilot-preflight-offline-input.mjs';
import { checkBindingManifest } from './merchant-image-pilot-preflight-offline-manifest.mjs';
import { checkBindingStaged } from './merchant-image-pilot-preflight-offline-staged.mjs';
import { checkBindingTiers } from './merchant-image-pilot-preflight-offline-tiers.mjs';
import {
  acceptanceKey,
  sameAcceptance,
  stagedOriginalName,
  validAcceptanceShape,
  validInventoryRecord,
} from './merchant-image-pilot-preflight-records.mjs';
import {
  fail,
  pass,
  readJson,
} from './merchant-image-pilot-preflight-shared.mjs';

export async function runOfflinePreflight(options) {
  const checks = [];
  const failures = [];
  // Bindings that passed every offline stage (acceptance, manifest
  // contract, tier bytes, staged bytes). The served gate requires an actual
  // mount of the expected kind/identity for exactly these bindings;
  // anything else must render a reporting row and is excluded from
  // optimized coverage by construction.
  const accepted = [];
  const effectiveRecipe = options.recipe ?? RECIPE_ID;
  if (effectiveRecipe !== RECIPE_ID) {
    fail(
      checks,
      failures,
      'recipe-pin',
      `caller recipe "${effectiveRecipe}" does not match the pinned recipe "${RECIPE_ID}"`
    );
    return { accepted, checks, failures, ok: false };
  }
  pass(checks, 'recipe-pin');
  let inventory;
  let acceptances;
  try {
    inventory = await readJson(options.inventory);
  } catch (error) {
    fail(
      checks,
      failures,
      'inventory-parse',
      `cannot read inventory (${error.message})`
    );
    return { accepted, checks, failures, ok: false };
  }
  try {
    acceptances = await readJson(options.acceptances);
  } catch (error) {
    fail(
      checks,
      failures,
      'acceptances-parse',
      `cannot read acceptances (${error.message})`
    );
    return { accepted, checks, failures, ok: false };
  }
  if (!Array.isArray(inventory) || inventory.length === 0) {
    fail(
      checks,
      failures,
      'inventory-parse',
      'inventory must be a non-empty array'
    );
    return { accepted, checks, failures, ok: false };
  }
  if (!Array.isArray(acceptances)) {
    fail(checks, failures, 'acceptances-parse', 'acceptances must be an array');
    return { accepted, checks, failures, ok: false };
  }
  const badInventory = inventory.filter(
    (record) => !validInventoryRecord(record)
  );
  if (badInventory.length > 0) {
    fail(
      checks,
      failures,
      'inventory-parse',
      `${badInventory.length} inventor${badInventory.length === 1 ? 'y record is' : 'y records are'} malformed`
    );
    return { accepted, checks, failures, ok: false };
  }
  // Mirror of parsePilotInventory: size cap plus merchant-scoped slot and
  // asset uniqueness. Offline must never report ok for an inventory the
  // route rejects.
  if (inventory.length > MAX_JOBS) {
    fail(
      checks,
      failures,
      'inventory-parse',
      `inventory holds ${inventory.length} records, at most ${MAX_JOBS} allowed`
    );
    return { accepted, checks, failures, ok: false };
  }
  const seenSlots = new Set();
  const seenAssets = new Set();
  for (const record of inventory) {
    const slotKey = `${record.merchantId}/${record.slot}`;
    const assetKey = `${record.merchantId}/${record.assetId}`;
    if (seenSlots.has(slotKey)) {
      fail(checks, failures, 'inventory-parse', `duplicate slot "${slotKey}"`);
      return { accepted, checks, failures, ok: false };
    }
    if (seenAssets.has(assetKey)) {
      fail(
        checks,
        failures,
        'inventory-parse',
        `duplicate asset "${assetKey}"`
      );
      return { accepted, checks, failures, ok: false };
    }
    seenSlots.add(slotKey);
    seenAssets.add(assetKey);
  }
  pass(checks, 'inventory-parse');

  // Frozen-sample pin: expectations derive from the supplied inventory,
  // so a silently reduced sample (deleted record or merchant) would
  // otherwise report ok:true on weaker evidence. When the operator pins
  // the planned merchant/asset/slot matrix, any shrinkage or growth
  // fails before expectations derive. Evidence runs must pass this flag.
  if (options.expectSample !== undefined && options.expectSample !== null) {
    let expected;
    try {
      expected = await readJson(options.expectSample);
    } catch (error) {
      fail(
        checks,
        failures,
        'sample-pin',
        `cannot read expect-sample (${error.message})`
      );
      return { accepted, checks, failures, ok: false };
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
      return { accepted, checks, failures, ok: false };
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
          ? [
              `inventory bindings outside the frozen sample: ${extra.join(', ')}`,
            ]
          : []),
      ];
      fail(checks, failures, 'sample-pin', details.join('; '));
      return { accepted, checks, failures, ok: false };
    }
    pass(checks, 'sample-pin');
  }

  const malformed = [];
  const byAsset = new Map();
  const conflicting = new Set();
  acceptances.forEach((record, position) => {
    if (!validAcceptanceShape(record)) {
      malformed.push(position);
      return;
    }
    const key = acceptanceKey(record);
    const prior = byAsset.get(key);
    if (!prior) {
      byAsset.set(key, record);
      return;
    }
    if (!sameAcceptance(prior, record)) {
      conflicting.add(key);
    }
  });
  if (malformed.length > 0) {
    fail(
      checks,
      failures,
      'acceptances-parse',
      `malformed acceptance records at index ${malformed.join(', ')}`
    );
  } else {
    pass(checks, 'acceptances-parse');
  }
  if (conflicting.size > 0) {
    fail(
      checks,
      failures,
      'acceptance-duplicates',
      `conflicting duplicates for ${[...conflicting].join(', ')}`
    );
  } else {
    pass(checks, 'acceptance-duplicates');
  }

  // Orphan acceptances: a review record for a binding the inventory no
  // longer carries means the sample changed without re-review — deleting
  // the inventory row must not silently narrow the evidence.
  const inventoryKeys = new Set(
    inventory.map((record) => acceptanceKey(record))
  );
  const orphans = [...byAsset.keys()].filter((key) => !inventoryKeys.has(key));
  if (orphans.length > 0) {
    fail(
      checks,
      failures,
      'acceptance-orphans',
      `acceptances without inventory records: ${orphans.join(', ')}`
    );
  } else {
    pass(checks, 'acceptance-orphans');
  }

  for (const record of inventory) {
    const name = `binding:${record.assetId}`;
    const stage = { checks, failures, name, options, record };
    const inputBytes = await checkBindingInput(stage);
    if (!inputBytes) {
      continue;
    }
    const acceptance = checkBindingAcceptance({
      ...stage,
      byAsset,
      conflicting,
      effectiveRecipe,
    });
    if (!acceptance) {
      continue;
    }
    const manifest = await checkBindingManifest({
      ...stage,
      acceptance,
      effectiveRecipe,
      inputBytes,
    });
    if (!manifest) {
      continue;
    }
    if (!(await checkBindingTiers({ ...stage, acceptance, manifest }))) {
      continue;
    }
    if (!(await checkBindingStaged({ ...stage, acceptance, manifest }))) {
      continue;
    }
    accepted.push({
      assetId: record.assetId,
      binding: acceptanceKey(record),
      generationId: acceptance.generationId,
      merchantId: record.merchantId,
      role: record.role,
      slotId: record.slot,
      stagedOriginal: `/__pilot/originals/${stagedOriginalName(
        { assetId: record.assetId, merchantId: record.merchantId },
        manifest.source.format
      )}`,
    });
  }
  return { accepted, checks, failures, ok: failures.length === 0 };
}
