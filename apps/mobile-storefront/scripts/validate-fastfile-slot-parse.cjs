function stripRubyComments(source) {
  let inBlockComment = false;
  return source
    .split('\n')
    .filter((line) => {
      if (/^=begin(?:\s|$)/.test(line)) {
        inBlockComment = true;
        return false;
      }
      if (inBlockComment) {
        if (/^=end(?:\s|$)/.test(line)) inBlockComment = false;
        return false;
      }
      return true;
    })
    .map((line) => line.replace(/(^|\s)#.*$/, '$1'))
    .join('\n');
}

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

/** Index of a call site, ignoring the `def` line that shares the same name. */
function callSiteIndex(source, methodName) {
  const match = new RegExp(
    `^[ \\t]*(?:return\\s+\\w+\\s+if\\s+|unless\\s+)?${methodName.replace(/[!?]/g, '\\$&')}\\(`,
    'm'
  ).exec(source);
  return match ? match.index : -1;
}

module.exports = {
  stripRubyComments,
  extractIndentedBlock,
  callSiteIndex,
};
