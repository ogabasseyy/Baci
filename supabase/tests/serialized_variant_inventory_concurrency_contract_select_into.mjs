const intoClausePattern =
  /\b(?:INSERT|MERGE)\s+INTO\b|\bINTO\b(\s+STRICT\b)?\s*((?:"[^"]+"|[a-z_][a-z0-9_]*)(?:\s*\.\s*(?:"[^"]+"|[a-z_][a-z0-9_]*))?(?:\s*,\s*(?:"[^"]+"|[a-z_][a-z0-9_]*)(?:\s*\.\s*(?:"[^"]+"|[a-z_][a-z0-9_]*))?)*)/gi;

const tableCreationLeaders = new Set([
  'temp',
  'temporary',
  'unlogged',
  'table',
]);

function normalizeIntoTarget(target) {
  return target.replace(/"/g, '').split('.')[0].trim().toLowerCase();
}

function selectIntoWritesVariable(window, variable) {
  const wanted = variable.toLowerCase();
  intoClausePattern.lastIndex = 0;
  for (const match of window.matchAll(intoClausePattern)) {
    if (/^(?:INSERT|MERGE)\b/i.test(match[0])) continue;
    const targets = match[2]
      .split(',')
      .map((target) => normalizeIntoTarget(target));
    if (tableCreationLeaders.has(targets[0])) continue;
    if (targets.includes(wanted)) return true;
  }
  return false;
}

export const serializedInventorySelectInto = {
  selectIntoWritesVariable,
};
