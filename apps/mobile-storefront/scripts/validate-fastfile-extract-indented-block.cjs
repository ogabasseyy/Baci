function extractIndentedBlock(source, declarationPattern, closingToken) {
  const lines = source.split('\n');
  const startIndex = lines.findIndex((line) => declarationPattern.test(line));
  if (startIndex === -1) return null;

  const indentation = lines[startIndex].match(/^\s*/)?.[0] ?? '';
  const closingLine = `${indentation}${closingToken}`;
  const endOffset = lines
    .slice(startIndex + 1)
    .findIndex((line) => line.trimEnd() === closingLine);
  if (endOffset === -1) return null;

  return lines.slice(startIndex, startIndex + endOffset + 2).join('\n');
}

module.exports = extractIndentedBlock;
