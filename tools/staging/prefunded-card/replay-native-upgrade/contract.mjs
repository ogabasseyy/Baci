import { createHash } from 'node:crypto';
import path from 'node:path';
import { authority } from './constants.mjs';

const hex = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const shape = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join('|') === [...keys].sort().join('|');

export function reviewOverlay(bytes, reviewedInventorySha256) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > 1_048_576
      || !hex(reviewedInventorySha256)
      || createHash('sha256').update(bytes).digest('hex') !== reviewedInventorySha256)
    throw new Error('Final reviewed inventory pin refused');
  let inventory;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    inventory = JSON.parse(text);
    const compact = text.replace(/("(?:\\.|[^"\\])*")|\s+/g, (value, quoted) => quoted ?? '');
    if (JSON.stringify(inventory) !== compact) throw new Error();
  } catch {
    throw new Error('Final inventory JSON refused');
  }
  if (!shape(inventory, ['schemaVersion', 'status', 'receiverRoot', 'deadline', 'originalReceiptId',
    'baselineProvenance', 'productionDelta', 'reviewFiles', 'unchangedImportedHarness', 'validation', 'handoff'])
      || inventory.schemaVersion !== 1 || inventory.status !== 'frozen-source-only-not-built-not-deployed'
      || inventory.receiverRoot !== authority.receiverRoot || inventory.deadline !== authority.deadline
      || inventory.originalReceiptId !== authority.receiptId
      || !Array.isArray(inventory.productionDelta)) throw new Error('Final inventory shape refused');
  const files = inventory.productionDelta.map((row) => {
    if (!shape(row, ['path', 'sha256', 'canonicalImportSha256']) || typeof row.path !== 'string'
        || !row.path.startsWith(inventory.receiverRoot + '/') || path.resolve(row.path) !== row.path)
      throw new Error('Final inventory source row refused');
    const target = path.relative(inventory.receiverRoot, row.path).split(path.sep).join('/');
    if (!hex(row.sha256) || (authority.newTargets.includes(target)
      ? row.canonicalImportSha256 !== null : !hex(row.canonicalImportSha256)))
      throw new Error('Final inventory source pin refused');
    return { target, source: target, canonicalSha256: row.canonicalImportSha256, replacementSha256: row.sha256 };
  });
  const targets = files.map((row) => row.target);
  if (targets.length !== authority.requiredTargets.length || new Set(targets).size !== targets.length
      || authority.requiredTargets.some((target) => !targets.includes(target)))
    throw new Error('Explicit inventory patch targets refused');
  for (const group of ['reviewFiles', 'unchangedImportedHarness']) {
    if (!Array.isArray(inventory[group])) throw new Error('Final inventory review set refused');
    for (const row of inventory[group]) {
      if (!shape(row, ['path', 'sha256']) || typeof row.path !== 'string'
          || !row.path.startsWith(inventory.receiverRoot + '/apps/web/src/')
          || path.resolve(row.path) !== row.path || !hex(row.sha256))
        throw new Error('Final inventory review row refused');
    }
  }
  return { receiverRoot: inventory.receiverRoot, files, inventory };
}
