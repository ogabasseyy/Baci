const definitionPatches = [
  {
    migration:
      '20260618133541_fix_storefront_order_id_ambiguity_inventory_and_voucher.sql',
    functions: [
      { proname: 'create_storefront_order', pronargs: null },
      { proname: 'create_storefront_order_with_quiz_voucher', pronargs: null },
    ],
    old: 'WHERE id = stock_rec.product_id',
    new: 'WHERE products.id = stock_rec.product_id',
  },
  {
    migration:
      '20260618133541_fix_storefront_order_id_ambiguity_inventory_and_voucher.sql',
    functions: [
      { proname: 'create_storefront_order', pronargs: null },
      { proname: 'create_storefront_order_with_quiz_voucher', pronargs: null },
    ],
    old: 'WHERE id = v_variant_id',
    new: 'WHERE product_variants.id = v_variant_id',
  },
  {
    migration:
      '20260618133541_fix_storefront_order_id_ambiguity_inventory_and_voucher.sql',
    functions: [
      { proname: 'create_storefront_order', pronargs: null },
      { proname: 'create_storefront_order_with_quiz_voucher', pronargs: null },
    ],
    old: 'WHERE id = v_reserved_order_id',
    new: 'WHERE orders.id = v_reserved_order_id',
  },
  {
    migration:
      '20260618133541_fix_storefront_order_id_ambiguity_inventory_and_voucher.sql',
    functions: [
      { proname: 'create_storefront_order', pronargs: null },
      { proname: 'create_storefront_order_with_quiz_voucher', pronargs: null },
    ],
    old: 'WHERE id = v_award_id',
    new: 'WHERE quiz_awards.id = v_award_id',
  },
  {
    migration:
      '20260618133541_fix_storefront_order_id_ambiguity_inventory_and_voucher.sql',
    functions: [
      { proname: 'create_storefront_order', pronargs: null },
      { proname: 'create_storefront_order_with_quiz_voucher', pronargs: null },
    ],
    old: 'WHERE id = (',
    new: 'WHERE order_items.id = (',
  },
  {
    migration: '20260927120000_order_storefront_claim_loop_by_product.sql',
    functions: [{ proname: 'create_storefront_order_unchecked', pronargs: 24 }],
    old: `    FOR v_item IN
      SELECT oi.id, oi.product_id, oi.variant_id
      FROM public.order_items oi
      WHERE oi.order_id = v_order_id
    LOOP`,
    new: `    FOR v_item IN
      SELECT oi.id, oi.product_id, oi.variant_id
      FROM public.order_items oi
      WHERE oi.order_id = v_order_id
      ORDER BY oi.product_id, oi.id
    LOOP`,
  },
  {
    migration: '20260927120000_order_storefront_claim_loop_by_product.sql',
    functions: [
      { proname: 'prepare_storefront_order_for_checkout', pronargs: 9 },
    ],
    old: `  FOR v_item IN
    SELECT oi.id, oi.product_id, oi.variant_id, oi.quantity
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
    FOR UPDATE
  LOOP`,
    new: `  FOR v_item IN
    SELECT oi.id, oi.product_id, oi.variant_id, oi.quantity
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
    ORDER BY oi.product_id, oi.id
    FOR UPDATE
  LOOP`,
  },
  {
    migration: '20260927130000_order_chat_claim_loop_by_product.sql',
    functions: [
      {
        proname: 'convert_chat_order_to_paid_order_with_inventory',
        pronargs: 5,
      },
    ],
    old: `  FOR v_item IN
    SELECT * FROM jsonb_to_recordset(v_chat_order.items) AS (
      product_id uuid,
      variant_id uuid,
      name text,
      quantity integer,
      price numeric
    )
  LOOP`,
    new: `  FOR v_item IN
    SELECT * FROM jsonb_to_recordset(v_chat_order.items) AS (
      product_id uuid,
      variant_id uuid,
      name text,
      quantity integer,
      price numeric
    )
    ORDER BY product_id, variant_id
  LOOP`,
  },
  {
    migration: '20260927140000_order_claim_loops_by_product_variant.sql',
    functions: [
      { proname: 'create_storefront_order_unchecked', pronargs: 24 },
      { proname: 'prepare_storefront_order_for_checkout', pronargs: 9 },
      { proname: 'confirm_order_inventory_reservations', pronargs: 2 },
      { proname: 'release_order_inventory_units', pronargs: 3 },
    ],
    old: 'ORDER BY oi.product_id, oi.id',
    new: 'ORDER BY oi.product_id, oi.variant_id, oi.id',
  },
  {
    migration: '20260927150000_order_unit_cursors_by_product_variant.sql',
    functions: [
      { proname: 'release_order_inventory_units', pronargs: 3 },
      { proname: 'mark_order_inventory_units_sold', pronargs: 2 },
    ],
    old: 'ORDER BY pv.product_id, vi.id',
    new: 'ORDER BY pv.product_id, vi.variant_id, vi.id',
  },
];

function parsePatchTarget(functionName) {
  const match = /^(.*)\(([^()]*)\)$/.exec(functionName.trim());
  const name = (match ? match[1] : functionName).trim();
  const bare = name.includes('.')
    ? name.slice(name.lastIndexOf('.') + 1)
    : name;
  const argumentTypes = match
    ? match[2]
        .split(',')
        .map((type) => type.trim())
        .filter(Boolean)
    : [];
  return { bare: bare.replace(/^"|"$/g, ''), nargs: argumentTypes.length };
}

function applyDefinitionPatches(functionName, body) {
  const { bare, nargs } = parsePatchTarget(functionName);
  let patched = body;
  for (const patch of definitionPatches) {
    if (
      !patch.functions.some(
        (target) =>
          target.proname === bare &&
          (target.pronargs === null || target.pronargs === nargs)
      )
    ) {
      continue;
    }
    patched = patched.replaceAll(patch.old, patch.new);
  }
  return patched;
}

function isTracedDefinitionTransform(oldText, newText) {
  return definitionPatches.some(
    (patch) => patch.old === oldText && patch.new === newText
  );
}

function stripDefinitionPatches(functionName, body) {
  const { bare, nargs } = parsePatchTarget(functionName);
  let stripped = body;
  for (const patch of [...definitionPatches].reverse()) {
    if (
      !patch.functions.some(
        (target) =>
          target.proname === bare &&
          (target.pronargs === null || target.pronargs === nargs)
      )
    ) {
      continue;
    }
    stripped = stripped.replaceAll(patch.new, patch.old);
  }
  return stripped;
}

export const serializedInventoryDefinitionPatches = {
  applyDefinitionPatches,
  definitionPatches,
  isTracedDefinitionTransform,
  stripDefinitionPatches,
};
