const path = require('node:path');

/** Keep native dependencies on the app's React instance, retaining Metro's export conditions. */
function resolveMobileReact(context, moduleName, platform, projectRoot) {
  if (!/^(react|react-dom)(\/|$)/.test(moduleName)) return null;
  return context.resolveRequest(
    { ...context, originModulePath: path.join(projectRoot, 'package.json') },
    moduleName,
    platform
  );
}

module.exports = resolveMobileReact;
