export function validateExportDigests(actual, recorded) {
  const actualNames = Object.keys(actual).sort();
  if (!recorded || typeof recorded !== 'object' || Array.isArray(recorded)) {
    throw new Error('Export files do not match the verified provenance.');
  }
  const recordedNames = Object.keys(recorded).sort();
  if (
    actualNames.length !== recordedNames.length ||
    actualNames.some((name, index) => name !== recordedNames[index] || actual[name] !== recorded[name])
  ) {
    throw new Error('Export files do not match the verified provenance.');
  }
}
