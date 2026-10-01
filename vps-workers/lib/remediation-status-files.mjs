export function parseRemediationStatusFiles(status) {
  return String(status || '')
    .split(/\r?\n/)
    .map((line) => line.slice(3).trim())
    .flatMap((line) => line.split(' -> '))
    .filter(Boolean);
}
