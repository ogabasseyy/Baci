// Test-harness parser for the migration's exact CREATE OR REPLACE definition.
export function extractSqlFunctionDefinition(text, schema, functionName) {
  const start = text.indexOf(
    `CREATE OR REPLACE FUNCTION ${schema}.${functionName}(`
  );
  if (start < 0) throw new Error(`Missing ${functionName}`);
  const body = text.slice(start);
  const delimiter = /AS (\$[a-z_]*\$)/i.exec(body);
  if (!delimiter) throw new Error(`Missing body ${functionName}`);
  const end = body.indexOf(
    `${delimiter[1]};`,
    delimiter.index + delimiter[0].length
  );
  if (end < 0) throw new Error(`Unterminated ${functionName}`);
  return body.slice(0, end + delimiter[1].length + 1);
}
