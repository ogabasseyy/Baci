function parseFunctionPrivilege(text) {
  const leading = text.trimStart();
  const prefix =
    /^(?:GRANT\s+(?:ALL(?:\s+PRIVILEGES)?|EXECUTE)|REVOKE\s+(?:ALL(?:\s+PRIVILEGES)?|EXECUTE))\s+ON\s+(?:FUNCTION|ROUTINE)\s+/i.exec(
      leading
    );
  if (!prefix) return null;
  let depth = 0;
  let quote;
  for (let index = prefix[0].length; index < leading.length; index += 1) {
    const char = leading[index];
    if (quote) {
      if (char === quote && leading[index + 1] === quote) index += 1;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    else if (char === '(') depth += 1;
    else if (char === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0) {
      const keyword = /^\s+(?:TO|FROM)\s+/i.exec(leading.slice(index));
      if (keyword) {
        return {
          functionList: leading.slice(prefix[0].length, index).trim(),
          grantees: leading
            .slice(index + keyword[0].length)
            .replace(/;\s*$/, '')
            .replace(
              /\s+(?:WITH\s+GRANT\s+OPTION|GRANTED\s+BY\s+(?:"[^"]+"|[a-z_][a-z0-9_]*))(?:\s+(?:WITH\s+GRANT\s+OPTION|GRANTED\s+BY\s+(?:"[^"]+"|[a-z_][a-z0-9_]*)))*\s*$/i,
              ''
            )
            .trim(),
          index: text.length - leading.length,
          operation: /^GRANT/i.test(prefix[0]) ? 'GRANT' : 'REVOKE',
        };
      }
    }
  }
  return null;
}

export const serializedInventoryPrivilegeParser = {
  parseFunctionPrivilege,
};
