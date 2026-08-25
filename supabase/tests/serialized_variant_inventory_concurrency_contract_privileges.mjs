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

function authenticatedCanExecute(source, signature) {
  const state = { authenticated: false, public: true };
  const pattern = new RegExp(
    `(?:GRANT\\s+EXECUTE|REVOKE\\s+(?:ALL(?:\\s+PRIVILEGES)?|EXECUTE))\\s+ON\\s+FUNCTION\\s+${signaturePattern(signature)}[^;]*?\\s+(?:TO|FROM)\\s+([^;]+);`,
    'gi'
  );
  for (const statement of source.matchAll(pattern)) {
    const grant = /^GRANT/i.test(statement[0]);
    if (/\bPUBLIC\b/i.test(statement[1])) state.public = grant;
    if (/\bauthenticated\b/i.test(statement[1])) state.authenticated = grant;
  }
  return state.public || state.authenticated;
}

function effectiveSecurityMode(source, signature) {
  const body = serializedInventoryContract.latestFunctionBody(signature, [
    source,
  ]);
  const createMode = /\bSECURITY\s+(DEFINER|INVOKER)\b/i.exec(body);
  const createIndex = source.lastIndexOf(body);
  const alterations = [
    ...source.matchAll(
      new RegExp(
        `ALTER\\s+FUNCTION\\s+${signaturePattern(signature)}\\s+SECURITY\\s+(DEFINER|INVOKER)\\s*;`,
        'gi'
      )
    ),
  ];
  const latestAlter = alterations.at(-1);
  return latestAlter && latestAlter.index > createIndex
    ? latestAlter[1].toLowerCase()
    : createMode?.[1].toLowerCase();
}

export const serializedInventoryPrivileges = {
  authenticatedCanExecute,
  effectiveSecurityMode,
};
