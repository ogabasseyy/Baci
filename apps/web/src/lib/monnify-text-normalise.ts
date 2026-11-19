/**
 * Reads machine-style Monnify wording as words: camelCase is split and "_"
 * / "-" become spaces, so "vendInProgress", "INVALID_TOKEN" and
 * "reference-already-exists" match the same patterns as plain sentences.
 */
export function normaliseMonnifyWording(text: string): string {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ');
}
