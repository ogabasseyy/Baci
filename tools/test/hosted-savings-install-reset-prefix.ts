import { createHash } from 'node:crypto';

export function hostedSavingsResetPrefix(sql: string) {
  if (createHash('sha256').update(sql).digest('hex') !== 'da9d344811c250a5f6cd44ee5e99fd130280e7cf947c0e47f128e53434337785')
    throw new Error('Recovery requires exact reviewed baseline bytes');
  const marker = 'CREATE OR REPLACE VIEW "public"."admin_query_performance"';
  const prefix = sql.slice(0, sql.indexOf(marker));
  const functions = prefix.split(/^CREATE OR REPLACE FUNCTION /m).slice(1).map((chunk) => {
    const signature = /^ALTER FUNCTION (.+) OWNER TO "postgres";$/m.exec(chunk)?.[1];
    const body = /\n\s+AS (\$[A-Za-z_]*\$)([\s\S]*?)\1;/m.exec(chunk)?.[2];
    if (!signature || body === undefined) throw new Error('Unknown baseline function syntax');
    return { signature: signature.replace(/"[a-z0-9_]+" (?="|[a-z])/g, ''), bodyMd5: createHash('md5').update(body).digest('hex') };
  });
  const orders = /^CREATE TABLE IF NOT EXISTS "public"\."orders" \([\s\S]*?^WITH \([^;]+;/m.exec(prefix)?.[0];
  if (functions.length !== 178 || !functions.at(-1)?.signature.startsWith('"public"."validate_order_number"') || !orders)
    throw new Error('Unexpected reviewed prefix closure');
  return { functions, orders: orders.replace('CREATE TABLE IF NOT EXISTS "public"."orders"', 'CREATE TEMP TABLE recovery_expected_orders') };
}
