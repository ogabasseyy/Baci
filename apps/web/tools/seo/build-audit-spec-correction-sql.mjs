import { correctAuditProduct } from './correct-audit-product-specs.mjs';

const merchantId = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const columns = [
  'screen_size_inches',
  'display_resolution',
  'charging_watt',
  'dimensions_mm',
  'weight_g',
  'battery_mah',
  'chipset',
  'cpu_cores',
  'gpu',
];
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const literal = (value) => (value == null ? 'null' : quote(value));
/** Produces maintenance SQL only; never connects or mutates a database. */
export function buildAuditSpecCorrectionSql(records) {
  if (records.length !== 6 || new Set(records.map((row) => row.id)).size !== 6)
    throw new Error('Expected six distinct audited products');
  const statements = records.map((before) => {
    if (
      !/^[0-9a-f-]{36}$/.test(before.id) ||
      !/^[0-9a-f]{32}$/.test(before.specifications_hash)
    )
      throw new Error('Invalid captured identity or hash');
    const after = correctAuditProduct(before);
    if (JSON.stringify(after) === JSON.stringify(before))
      throw new Error(`No verified correction for ${before.slug}`);
    const assignments = columns
      .filter((key) => after.key_specs[key] !== before.key_specs[key])
      .map((key) => `${key} = ${literal(after.key_specs[key])}`);
    const guard = columns
      .map(
        (key) =>
          `k.${key} is not distinct from ${literal(before.key_specs[key])}`
      )
      .join(' and ');
    return `update public.product_key_specs k set ${assignments.join(', ')} from public.products p where k.product_id=p.id and p.id=${quote(before.id)}::uuid and p.merchant_id=${quote(merchantId)}::uuid and p.slug=${quote(before.slug)} and ${guard};
get diagnostics changed = row_count;
if changed <> 1 then raise exception 'Concurrent or missing key specs: ${before.slug}'; end if;
update public.products set specifications=${quote(JSON.stringify(after.specifications))}::jsonb where id=${quote(before.id)}::uuid and merchant_id=${quote(merchantId)}::uuid and slug=${quote(before.slug)} and md5(specifications::text)=${quote(before.specifications_hash)};
get diagnostics changed = row_count;
if changed <> 1 then raise exception 'Concurrent or missing product: ${before.slug}'; end if;`;
  });
  return `-- Bounded owner-requested catalog maintenance. No schema, price, stock or condition changes.\nbegin;\ndo $audit$\ndeclare changed integer;\nbegin\n${statements.join('\n')}\nend;\n$audit$;\ncommit;\n`;
}
