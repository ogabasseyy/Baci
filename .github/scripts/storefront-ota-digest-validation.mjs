export function validateExportDigests(actual, recorded) {
  const actualNames = Object.keys(actual).sort();
  const recordedNames = recorded && typeof recorded === 'object' ? Object.keys(recorded).sort() : [];
  if (
    actualNames.length !== recordedNames.length ||
    actualNames.some((name, index) => name !== recordedNames[index] || actual[name] !== recorded[name])
  ) {
    throw new Error('Export files do not match the verified provenance.');
  }
}
