import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildQualitySheet } from './quality-sheet.mjs';
import { publishQualitySheet } from './quality-sheet-publish.mjs';
import { parseMountCrop } from './quality-sheet-mounts.mjs';
import { setupPilot } from './quality-sheet-fixtures.mjs';

test('keeps tier aspect ratio in DPR rows and warns on over-source', async () => {
  // The hero slot has no canonical mount: these rows exercise the legacy
  // intrinsic render whose height:auto style this test asserts.
  const { inputRoot, inventoryPath, outputRoot } = await setupPilot(
    undefined,
    'mobile-hero-slide-0'
  );
  const html = await buildQualitySheet({
    inputRoot,
    inventoryPath,
    outputRoot,
    slots: { 'mobile-hero-slide-0': { cssWidth: 40 } },
  });
  // The tiny-48x48 ladder encodes over-source on every tier (incompatible
  // codec, bytes above source): the sheet must say so, per tier and up
  // top, instead of implying merchant-wide savings.
  assert.match(html, /height:auto/);
  assert.match(html, /Over-source warning/);
  assert.match(html, /6 tier\(s\) serve more bytes than their source/);
  assert.match(html, /over-source/);
});

test('renders cropped mounts in the real CSS box on both sides', async () => {
  // A square source on a 16:9 cover mount: intrinsic-aspect rendering
  // would hide the clip, so original and tiers must share the mount box
  // at the slot CSS width — and the sheet must record it.
  const { inputRoot, inventoryPath, outputRoot } = await setupPilot();
  const mount = { aspectRatio: '16 / 9', fit: 'cover', position: '50% 50%' };
  const html = await buildQualitySheet({
    inputRoot,
    inventoryPath,
    outputRoot,
    slots: { 'header-logo': { cssWidth: 40, mount } },
  });
  // Original and tiers share the mount box: more than one PNG raster
  // carries the aspect style.
  assert.ok(
    [
      ...html.matchAll(
        /<img src="data:image\/png[^>]*style="width:40px;aspect-ratio:16 \/ 9;object-fit:cover;object-position:50% 50%"/g
      ),
    ].length > 1
  );
  assert.match(html, /mount 16 \/ 9 cover 50% 50%/);
  // No mount on a fixed-geometry cropped slot: the canonical header-logo
  // mount (1/1 cover) renders instead of the legacy intrinsic box, and
  // the sheet records it — a reviewer can no longer accept branding the
  // real circular mount clips away.
  const canonical = await buildQualitySheet({
    inputRoot,
    inventoryPath,
    outputRoot,
    slots: { 'header-logo': { cssWidth: 40 } },
  });
  assert.match(
    canonical,
    /<img src="data:image\/png[^>]*style="width:40px;aspect-ratio:1 \/ 1;object-fit:cover;object-position:50% 50%"/
  );
  assert.match(canonical, /mount 1 \/ 1 cover 50% 50%/);
});

test('rejects malformed mount boxes instead of misrendering the clip', async () => {
  const { inputRoot, inventoryPath, outputRoot } = await setupPilot();
  const good = { aspectRatio: '16 / 9', fit: 'cover', position: '50% 50%' };
  for (const [name, mount] of [
    ['ratio', { ...good, aspectRatio: '16x9' }],
    ['ratio-zero', { ...good, aspectRatio: '0 / 9' }],
    ['fit', { ...good, fit: 'fill' }],
    // CSS injection through the position string must fail validation,
    // not land in a style attribute.
    ['position', { ...good, position: '50%;color:red' }],
    ['position-tag', { ...good, position: '50% <x' }],
    ['shape', '16 / 9 cover'],
  ]) {
    await assert.rejects(
      () =>
        buildQualitySheet({
          inputRoot,
          inventoryPath,
          outputRoot,
          slots: { 'header-logo': { cssWidth: 40, mount } },
        }),
      /invalid mount/,
      `mount ${name} must fail closed`
    );
  }
});

test('rejects axis-invalid position pairs instead of misclaiming the crop', () => {
  // Same-axis keyword pairs are invalid CSS: the browser would drop
  // the declaration (centered crop) while the caption claims the
  // supplied position. Percents lock their slot (first horizontal,
  // second vertical); `center` is neutral and keywords swap.
  const good = { aspectRatio: '16 / 9', fit: 'cover' };
  for (const position of [
    '50% 50%',
    'center',
    'left top',
    'top left',
    'center left',
    'left 50%',
    '50% top',
  ]) {
    assert.equal(
      parseMountCrop({ mount: { ...good, position } }, 'x').position,
      position
    );
  }
  for (const position of [
    'left right',
    'right left',
    'top bottom',
    '50% left',
    'top 50%',
  ]) {
    assert.throws(
      () => parseMountCrop({ mount: { ...good, position } }, 'x'),
      /incompatible axes/
    );
  }
});

test('the sheet refuses to embed past the aggregate byte budget', async () => {
  const { inputRoot, inventoryPath, outputRoot } = await setupPilot();
  const slots = { 'header-logo': { cssWidth: 40 } };
  // One byte of budget: the first record alone exceeds it, so the sheet
  // fails fast before embedding anything — never an OOM mid-render and
  // never a partial sheet a reviewer might trust as complete.
  await assert.rejects(
    () =>
      buildQualitySheet({
        inputRoot,
        inventoryPath,
        limits: { maxEmbeddedBytes: 1 },
        outputRoot,
        slots,
      }),
    /exceeds the 1-byte embed budget/
  );
  // The default ceiling still renders the legitimate single-asset sheet.
  const html = await buildQualitySheet({
    inputRoot,
    inventoryPath,
    outputRoot,
    slots,
  });
  assert.match(html, /tiny-a/);
});

test('parseMountCrop derives canonical mounts, explicit wins, hero stays intrinsic', () => {
  // Fixed-geometry cropped slots fall back to the canonical mount the
  // lab consumers paint; an explicit --slots mount always wins.
  assert.deepEqual(parseMountCrop({ cssWidth: 40 }, 'header-logo'), {
    aspectRatio: '1 / 1',
    boxAspect: 1,
    fit: 'cover',
    position: '50% 50%',
  });
  assert.deepEqual(parseMountCrop({ cssWidth: 384 }, 'product-card'), {
    aspectRatio: '16 / 9',
    boxAspect: 16 / 9,
    fit: 'cover',
    position: '50% 50%',
  });
  assert.deepEqual(
    parseMountCrop(
      {
        cssWidth: 40,
        mount: { aspectRatio: '4 / 3', fit: 'contain', position: 'center' },
      },
      'header-logo'
    ),
    { aspectRatio: '4 / 3', boxAspect: 4 / 3, fit: 'contain', position: 'center' }
  );
  // mobile-hero-slide-0 has no canonical mount (its fit is data-driven,
  // contain or cover per projection): absent mount keeps the legacy
  // intrinsic render instead of a misrendered guess.
  assert.equal(parseMountCrop({ cssWidth: 390 }, 'mobile-hero-slide-0'), null);
  assert.equal(parseMountCrop({ cssWidth: 40 }, 'slot-unknown'), null);
  // An explicit null mount still fails closed rather than silently
  // gaining a canonical render the operator did not ask for.
  assert.throws(
    () => parseMountCrop({ cssWidth: 40, mount: null }, 'header-logo'),
    /mount must be an object/
  );
});

test('publishQualitySheet replaces the old sheet atomically, never a prefix', async () => {
  const { mkdtemp, readdir } = await import('node:fs/promises');
  const dir = await mkdtemp(join(tmpdir(), 'pilot-sheet-publish-'));
  const out = join(dir, 'sheet.html');
  await writeFile(out, '<old-sheet/>');
  const html = `<html>${'x'.repeat(100_000)}</html>`;
  await publishQualitySheet(out, html);
  assert.equal(await readFile(out, 'utf8'), html);
  assert.deepEqual(await readdir(dir), ['sheet.html']);
  // A real directory-sync failure is loud (unsupported platforms stay
  // silent, matching the inventory publish downgrade philosophy).
  await assert.rejects(
    publishQualitySheet(join(dir, 'sheet2.html'), html, {
      fsyncDir: async () => {
        throw Object.assign(new Error('nope'), { code: 'EIO' });
      },
    }),
    /sheet directory sync failed/
  );
});
