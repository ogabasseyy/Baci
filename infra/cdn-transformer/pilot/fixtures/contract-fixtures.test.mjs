import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchAcceptance, parsePilotAcceptance } from '../acceptance.mjs';
import {
  PILOT_POLICY_VERSION,
  PILOT_SCHEMA_VERSION,
  RECIPE_ID,
} from '../constants.mjs';
import { parsePilotManifest } from '../manifest.mjs';

const here = dirname(fileURLToPath(import.meta.url));

async function loadFixtures() {
  return JSON.parse(await readFile(join(here, 'contract-fixtures.json'), 'utf8'));
}

test('generator pins the shared contract identity', async () => {
  const fixtures = await loadFixtures();
  assert.equal(fixtures.pinned.schemaVersion, PILOT_SCHEMA_VERSION);
  assert.equal(fixtures.pinned.policyVersion, PILOT_POLICY_VERSION);
  assert.equal(fixtures.pinned.recipeId, RECIPE_ID);
});

test('generator accepts offset-bearing timestamps like the web mirror', async () => {
  const fixtures = await loadFixtures();
  assert.equal(parsePilotManifest(fixtures.validManifestOffset).ok, true);
  assert.equal(parsePilotAcceptance(fixtures.validAcceptanceOffset).ok, true);
});

test('generator accepts the shared valid contract pair', async () => {
  const fixtures = await loadFixtures();
  assert.equal(parsePilotManifest(fixtures.validManifest).ok, true);
  assert.equal(parsePilotAcceptance(fixtures.validAcceptance).ok, true);
  assert.deepEqual(
    matchAcceptance({
      acceptance: fixtures.validAcceptance,
      manifest: fixtures.validManifest,
    }),
    { ok: true }
  );
});

test('generator accepts the guarded r2 manifest and keeps legacy r1 valid', async () => {
  const fixtures = await loadFixtures();
  assert.equal(parsePilotManifest(fixtures.validManifestGuarded).ok, true);
  assert.equal(
    fixtures.validManifest.tiers.every((tier) => tier.delivery === undefined),
    true
  );
});

test('generator rejects every shared invalid manifest', async () => {
  const fixtures = await loadFixtures();
  for (const [label, candidate] of Object.entries(fixtures.invalidManifests)) {
    assert.equal(parsePilotManifest(candidate).ok, false, label);
  }
});

test('corpus pins the invalid-manifest key set (no silent case loss)', async () => {
  const fixtures = await loadFixtures();
  // The three suites iterate whatever keys exist, so a dropped case
  // would pass silently. Pin the set: the delivery-omission, geometry,
  // and never-larger cases must all be present.
  assert.deepEqual(Object.keys(fixtures.invalidManifests).sort(), [
    'assetIdTooLong',
    'badContentType',
    'badCreatedAt',
    'badEncoderExtra',
    'badEncoderName',
    'badEncoderShape',
    'badMerchant',
    'badPolicyVersion',
    'badQuality',
    'badRole',
    'badSchemaVersion',
    'contentTypeFormatMismatch',
    'deliveryNull',
    'duplicateTier',
    'emptyTiers',
    'generatedAboveSource',
    'generatedHeightOffAspect',
    'generatedWidthTooNarrow',
    'generatedWidthUpscaled',
    'generatedWithoutQuality',
    'hashPathMismatch',
    'missingTier',
    'overRecipeCeiling',
    'overSourceWithoutCause',
    'passthroughByteMismatch',
    'passthroughWithQuality',
    'passthroughWrongCodec',
    'qualityZero',
    'r2MissingDelivery',
    'remoteUrlPath',
    'reorderedTiers',
    'sourceExtraField',
    'sourceFormatGif',
    'tierBytesZero',
    'tierExtraField',
    'tooManyTiers',
    'traversalPath',
    'unknownField',
    'widthActualMismatch',
    'wrongLadder',
  ]);
});

test('generator rejects every shared invalid acceptance and matcher drift', async () => {
  const fixtures = await loadFixtures();
  for (const [label, candidate] of Object.entries(fixtures.invalidAcceptanceSchemas)) {
    assert.equal(parsePilotAcceptance(candidate).ok, false, label);
  }
  for (const [label, candidate] of Object.entries(fixtures.matcherRejections)) {
    const result = matchAcceptance({
      acceptance: candidate,
      manifest: fixtures.validManifest,
    });
    assert.equal(result.ok, false, label);
  }
});
