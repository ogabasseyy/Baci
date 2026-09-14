export function validateMatrix(matrix) {
  if (
    !matrix ||
    !Number.isInteger(matrix.coldRuns) ||
    matrix.coldRuns < 1 ||
    !Array.isArray(matrix.routes) ||
    !matrix.routes.length ||
    !Array.isArray(matrix.profiles) ||
    !matrix.profiles.length ||
    matrix.profiles.some(
      (profile) => !['mobile', 'desktop'].includes(profile)
    ) ||
    new Set(matrix.profiles).size !== matrix.profiles.length ||
    matrix.routes.some(
      (route) =>
        !route ||
        typeof route.family !== 'string' ||
        !/^[a-z0-9-]+$/.test(route.family) ||
        typeof route.path !== 'string' ||
        !route.path.startsWith('/') ||
        route.path.startsWith('//')
    ) ||
    new Set(matrix.routes.map((route) => route.family)).size !==
      matrix.routes.length
  ) {
    throw new Error('invalid route matrix');
  }
  return matrix;
}
