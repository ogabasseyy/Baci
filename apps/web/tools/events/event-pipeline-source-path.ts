export function isTestSourcePath(path: string): boolean {
  if (/\/test-fixtures\//.test(path)) return true;
  return /\.(?:test|tests|spec|specs|test-suite|test-(?:setup|support|helpers?|fixtures?|utils(?:\.[a-z]+)?))\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/.test(
    path
  );
}
