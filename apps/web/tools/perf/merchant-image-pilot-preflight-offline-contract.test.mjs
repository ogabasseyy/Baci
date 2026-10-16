import { copyFile, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runOfflinePreflight } from './merchant-image-pilot-preflight-offline.mjs';
import {
  MERCHANT,
  offlineOptions,
  setupOffline,
  setupOfflineAssets,
} from './merchant-image-pilot-preflight-offline-fixtures.mjs';

describe('preflight offline gate: route contract', () => {
  it('rejects ladder gaps and hash-set drift against the route contract', async () => {
    const fixture = await setupOffline();
    const manifestPath = join(
      fixture.outputRoot,
      'generations',
      fixture.generationId,
      'manifest.json'
    );
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const dropped = manifest.tiers.pop();
    await writeFile(manifestPath, JSON.stringify(manifest));
    const acceptances = JSON.parse(
      await readFile(fixture.acceptancesPath, 'utf8')
    );
    acceptances[0].outputHashes = acceptances[0].outputHashes.filter(
      (hash) => hash !== dropped.sha256
    );
    await writeFile(fixture.acceptancesPath, JSON.stringify(acceptances));
    const gapped = await runOfflinePreflight(offlineOptions(fixture));
    expect(gapped.ok).toBe(false);
    expect(gapped.failures.join('\n')).toMatch(/ladder/);

    const whole = await setupOffline();
    const wholeAcceptances = JSON.parse(
      await readFile(whole.acceptancesPath, 'utf8')
    );
    wholeAcceptances[0].outputHashes.push('f'.repeat(64));
    await writeFile(whole.acceptancesPath, JSON.stringify(wholeAcceptances));
    const drifted = await runOfflinePreflight(offlineOptions(whole));
    expect(drifted.ok).toBe(false);
    expect(drifted.failures.join('\n')).toMatch(
      /output bytes changed|hashes differ/i
    );
  });

  it('mirrors the route inventory contract (charset, url, dups, cap)', async () => {
    const readInventory = async (fixture) =>
      JSON.parse(await readFile(fixture.inventoryPath, 'utf8'));
    const writeInventory = async (fixture, records) =>
      writeFile(fixture.inventoryPath, JSON.stringify(records));

    const badAsset = await setupOffline();
    const assetRecords = await readInventory(badAsset);
    assetRecords[0].assetId = 'has space!';
    await writeInventory(badAsset, assetRecords);
    // Re-freeze the pin around the malformed key so this case exercises
    // inventory validation, not the sample-pin guard.
    await writeFile(
      badAsset.samplePath,
      JSON.stringify([`${MERCHANT}/has space!/header-logo`])
    );
    const badAssetReport = await runOfflinePreflight(offlineOptions(badAsset));
    expect(badAssetReport.ok).toBe(false);
    expect(badAssetReport.failures.join('\n')).toMatch(/malformed/);

    const badUrl = await setupOffline();
    const urlRecords = await readInventory(badUrl);
    urlRecords[0].url = 'ftp://cdn.example.com/media/logo-a.png';
    await writeInventory(badUrl, urlRecords);
    const badUrlReport = await runOfflinePreflight(offlineOptions(badUrl));
    expect(badUrlReport.ok).toBe(false);
    expect(badUrlReport.failures.join('\n')).toMatch(/malformed/);

    const dupSlot = await setupOffline();
    const slotRecords = await readInventory(dupSlot);
    slotRecords.push({ ...slotRecords[0], assetId: 'logo-b' });
    await writeInventory(dupSlot, slotRecords);
    const dupSlotReport = await runOfflinePreflight(offlineOptions(dupSlot));
    expect(dupSlotReport.ok).toBe(false);
    expect(dupSlotReport.failures.join('\n')).toMatch(/duplicate slot/);

    const dupAsset = await setupOffline();
    const assetDupRecords = await readInventory(dupAsset);
    assetDupRecords.push({ ...assetDupRecords[0], slot: 'product-card' });
    await writeInventory(dupAsset, assetDupRecords);
    const dupAssetReport = await runOfflinePreflight(offlineOptions(dupAsset));
    expect(dupAssetReport.ok).toBe(false);
    expect(dupAssetReport.failures.join('\n')).toMatch(/duplicate asset/);

    const oversized = await setupOffline();
    const manyRecords = await readInventory(oversized);
    for (let index = 0; index < 20; index += 1) {
      manyRecords.push({
        ...manyRecords[0],
        assetId: `logo-extra-${index}`,
        slot: `slot-extra-${index}`,
      });
    }
    await writeInventory(oversized, manyRecords);
    const oversizedReport = await runOfflinePreflight(
      offlineOptions(oversized)
    );
    expect(oversizedReport.ok).toBe(false);
    expect(oversizedReport.failures.join('\n')).toMatch(/at most 20/);

    // The route's z.uuid() requires a version 1-8 + RFC variant nibble
    // (nil/max excepted): shape-valid non-conforming merchants must fail
    // the record mirror, not slip through to a route 500.
    const badMerchant = await setupOffline();
    const merchantRecords = await readInventory(badMerchant);
    merchantRecords[0].merchantId = 'de968340-de02-0aa8-95f9-9d5f7d2b1f20';
    await writeInventory(badMerchant, merchantRecords);
    const badMerchantReport = await runOfflinePreflight(
      offlineOptions(badMerchant)
    );
    expect(badMerchantReport.ok).toBe(false);
    expect(badMerchantReport.failures.join('\n')).toMatch(/malformed/);

    // The route caps slotId at 128 chars (slot becomes slotId).
    const longSlot = await setupOffline();
    const longSlotRecords = await readInventory(longSlot);
    longSlotRecords[0].slot = `s${'l'.repeat(128)}`;
    await writeInventory(longSlot, longSlotRecords);
    const longSlotReport = await runOfflinePreflight(offlineOptions(longSlot));
    expect(longSlotReport.ok).toBe(false);
    expect(longSlotReport.failures.join('\n')).toMatch(/malformed/);
  });

  it('accepts the route UUID edge cases (nil and max)', async () => {
    for (const merchantId of [
      '00000000-0000-0000-0000-000000000000',
      'ffffffff-ffff-ffff-ffff-ffffffffffff',
    ]) {
      const fixture = await setupOfflineAssets([
        {
          assetId: 'logo-a',
          ladder: [96, 192, 384],
          merchantId,
          role: 'logo',
          slot: 'header-logo',
          url: 'https://cdn.example.com/media/logo-a.png',
        },
      ]);
      const report = await runOfflinePreflight(offlineOptions(fixture));
      expect(report.failures).toEqual([]);
      expect(report.ok).toBe(true);
    }
  });

  it('verifies input snapshots against the inventory claim', async () => {
    const tampered = await setupOffline();
    const inputRecords = JSON.parse(
      await readFile(tampered.inventoryPath, 'utf8')
    );
    const inputPath = join(tampered.inputRoot, inputRecords[0].sourcePath);
    await writeFile(inputPath, 'tampered-bytes');
    const tamperedReport = await runOfflinePreflight(offlineOptions(tampered));
    expect(tamperedReport.ok).toBe(false);
    expect(tamperedReport.failures.join('\n')).toMatch(/:input/);

    const missing = await setupOffline();
    const missingRecords = JSON.parse(
      await readFile(missing.inventoryPath, 'utf8')
    );
    await unlink(join(missing.inputRoot, missingRecords[0].sourcePath));
    const missingReport = await runOfflinePreflight(offlineOptions(missing));
    expect(missingReport.ok).toBe(false);
    expect(missingReport.failures.join('\n')).toMatch(/:input/);
  });

  it('rejects sourcePath shapes the route refuses', async () => {
    // Mirror of lab-route isSafeRelativePath: dot segments, absolute paths,
    // and backslashes never reach the snapshot gate, even when the bytes
    // behind the normalized path would hash correctly.
    for (const sourcePath of [
      'nested/./logo-a.png',
      '/etc/pilot-logo.png',
      'nested\\logo-a.png',
    ]) {
      const fixture = await setupOffline();
      const records = JSON.parse(await readFile(fixture.inventoryPath, 'utf8'));
      await mkdir(join(fixture.inputRoot, 'nested'), { recursive: true });
      await copyFile(
        join(fixture.inputRoot, records[0].sourcePath),
        join(fixture.inputRoot, 'nested', 'logo-a.png')
      );
      records[0].sourcePath = sourcePath;
      await writeFile(fixture.inventoryPath, JSON.stringify(records));
      const report = await runOfflinePreflight(offlineOptions(fixture));
      expect(report.ok).toBe(false);
      expect(report.failures.join('\n')).toMatch(/inventory-parse/);
    }
  });
});
