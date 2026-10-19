/** Shared by runtime tools/list and the public server card. */
export const MCP_SEARCH_CATEGORY_GUIDANCE =
  'Optional catalog category filter (case-insensitive substring matching). Use only a category explicitly requested by the shopper; otherwise omit this field and use intent.alternatives[].product_type. Do not guess Accessories for cameras. When the shopper names a brand and model, include both in intent.alternatives[].brands and intent.alternatives[].model, with the applicable product_type; query keywords alone do not replace these explicit constraints.';
