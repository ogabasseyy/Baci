export function bindSql(statement, parameters) {
  if (!/^SELECT\s/.test(statement))
    throw new Error('Only contract SELECT statements accepted');
  const used = new Set();
  const bound = statement.replace(/\$(\d+)/g, (_placeholder, position) => {
    const index = Number(position) - 1;
    if (index < 0 || index >= parameters.length)
      throw new Error('Contract parameter mismatch');
    used.add(index);
    const value = parameters[index];
    if (value === null) return 'NULL';
    if (Buffer.isBuffer(value))
      return `decode('${value.toString('hex')}', 'hex')`;
    if (typeof value === 'number' && Number.isSafeInteger(value))
      return String(value);
    if (typeof value !== 'string')
      throw new Error('Unsupported contract parameter');
    return `'${value.replaceAll("'", "''")}'`;
  });
  if (used.size !== parameters.length)
    throw new Error('Contract parameter mismatch');
  return bound;
}
