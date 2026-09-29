function maskNestedQueries(source) {
  let output = '';
  for (let index = 0; index < source.length; index += 1) {
    if (
      source[index] !== '(' ||
      !/^\(\s*(?:SELECT|WITH|VALUES|TABLE)\b/i.test(source.slice(index))
    ) {
      output += source[index];
      continue;
    }
    let depth = 0;
    for (; index < source.length; index += 1) {
      const char = source[index];
      if (char === '(') depth += 1;
      if (char === ')') depth -= 1;
      output += char === '\n' || char === '\r' ? char : ' ';
      if (depth === 0) break;
    }
  }
  return output;
}

export const serializedInventoryNestedQueries = { maskNestedQueries };
