export function parseRemediationStatusFiles(status) {
  const records = String(status || '').split('\0');
  const files = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.length < 4 || record[2] !== ' ') continue;
    files.push(record.slice(3));
    if (/[RC]/.test(record.slice(0, 2)) && records[index + 1]) {
      files.push(records[index + 1]);
      index += 1;
    }
  }
  return files;
}
