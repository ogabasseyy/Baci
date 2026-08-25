import { serializedInventoryContract } from './serialized_variant_inventory_concurrency_contract.mjs';

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function signaturePattern(signature) {
  return escapeRegex(signature)
    .replaceAll('\\.', '\\s*\\.\\s*')
    .replaceAll(',', '\\s*,\\s*')
    .replaceAll(' ', '\\s+');
}

function functionLifecycleEvents(source, signature) {
  const parsed = /^(.*)\(([^()]*)\)$/.exec(signature);
  if (!parsed) return [];
  const parameters = parsed[2]
    .split(',')
    .map((type) => type.trim())
    .filter(Boolean)
    .map(
      (type) =>
        `\\s*(?:(?:INOUT|IN|VARIADIC)\\s+)?(?:(?:"[^"]+"|[a-z_][a-z0-9_]*)\\s+)?${signaturePattern(type)}(?:\\s+(?:DEFAULT\\b|=)[^,)]*)?\\s*`
    )
    .join('\\s*,\\s*');
  const name = signaturePattern(parsed[1]);
  const creates = [
    ...source.matchAll(
      new RegExp(
        `CREATE\\s+(OR\\s+REPLACE\\s+)?FUNCTION\\s+${name}\\s*\\(${parameters}\\)`,
        'gi'
      )
    ),
  ].map((match) => ({
    index: match.index,
    kind: 'create',
    replace: match[1] !== undefined,
  }));
  const drops = [
    ...source.matchAll(
      new RegExp(
        `DROP\\s+FUNCTION(?:\\s+IF\\s+EXISTS)?\\s+${signaturePattern(signature)}[^;]*;`,
        'gi'
      )
    ),
  ].map((match) => ({ index: match.index, kind: 'drop' }));
  return [...creates, ...drops];
}

function authenticatedCanExecute(source, signature) {
  const state = { authenticated: false, exists: false, public: false };
  const pattern = new RegExp(
    `(?:GRANT\\s+EXECUTE|REVOKE\\s+(?:ALL(?:\\s+PRIVILEGES)?|EXECUTE))\\s+ON\\s+FUNCTION\\s+${signaturePattern(signature)}[^;]*?\\s+(?:TO|FROM)\\s+([^;]+);`,
    'gi'
  );
  const privileges = [...source.matchAll(pattern)].map((match) => ({
    index: match.index,
    kind: 'privilege',
    match,
  }));
  const events = [
    ...functionLifecycleEvents(source, signature),
    ...privileges,
  ].sort((left, right) => left.index - right.index);
  for (const event of events) {
    if (event.kind === 'drop') {
      state.exists = false;
      state.public = false;
      state.authenticated = false;
    } else if (event.kind === 'create') {
      if (!event.replace || !state.exists) {
        state.public = true;
        state.authenticated = false;
      }
      state.exists = true;
    } else {
      const grant = /^GRANT/i.test(event.match[0]);
      if (/\bPUBLIC\b/i.test(event.match[1])) state.public = grant;
      if (/\bauthenticated\b/i.test(event.match[1]))
        state.authenticated = grant;
    }
  }
  return state.exists && (state.public || state.authenticated);
}

function effectiveSecurityMode(sourceOrSources, signature) {
  const sources = Array.isArray(sourceOrSources)
    ? sourceOrSources
    : [sourceOrSources];
  const body = serializedInventoryContract.latestFunctionBody(
    signature,
    sources
  );
  const createMode = /\bSECURITY\s+(DEFINER|INVOKER)\b/i.exec(body);
  const definitionSourceIndex = sources.findLastIndex((source) =>
    source.includes(body)
  );
  const definitionIndex = sources[definitionSourceIndex].lastIndexOf(body);
  const alterationPattern = new RegExp(
    `ALTER\\s+FUNCTION\\s+${signaturePattern(signature)}\\s+SECURITY\\s+(DEFINER|INVOKER)\\s*;`,
    'gi'
  );
  const alterations = sources.flatMap((source, sourceIndex) =>
    [...source.matchAll(alterationPattern)]
      .filter(
        (match) =>
          sourceIndex > definitionSourceIndex ||
          (sourceIndex === definitionSourceIndex &&
            match.index > definitionIndex)
      )
      .map((match) => match[1])
  );
  const latestAlter = alterations.at(-1);
  return latestAlter?.toLowerCase() ?? createMode?.[1].toLowerCase();
}

export const serializedInventoryPrivileges = {
  authenticatedCanExecute,
  effectiveSecurityMode,
};
