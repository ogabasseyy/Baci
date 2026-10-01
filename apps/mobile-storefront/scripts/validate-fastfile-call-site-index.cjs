function callSiteIndex(source, methodName) {
  const match = new RegExp(
    `^[ \\t]*(?:return\\s+\\w+\\s+if\\s+|unless\\s+)?${methodName.replace(/[!?]/g, '\\$&')}\\(`,
    'm'
  ).exec(source);
  return match ? match.index : -1;
}

module.exports = callSiteIndex;
