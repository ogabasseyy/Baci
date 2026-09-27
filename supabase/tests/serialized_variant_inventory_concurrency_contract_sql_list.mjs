function splitTopLevelList(source) {
  const targets = [];
  let start = 0;
  let depth = 0;
  let quote;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === quote && source[index + 1] === quote) index += 1;
      else if (char === quote) quote = undefined;
    } else if (char === "'" || char === '"') quote = char;
    else if (char === '(') depth += 1;
    else if (char === ')') depth = Math.max(0, depth - 1);
    else if (char === ',' && depth === 0) {
      targets.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  targets.push(source.slice(start).trim());
  return targets;
}

export const serializedInventorySqlList = {
  splitTopLevelList,
};
