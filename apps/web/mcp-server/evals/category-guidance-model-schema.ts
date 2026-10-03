import type { jsonSchema } from 'ai';

type JsonSchema = Parameters<typeof jsonSchema>[0];

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function merge(base: Record<string, unknown>, override: Record<string, unknown>) {
  const merged = { ...base, ...override };
  if (base.properties || override.properties) {
    const properties = { ...record(base.properties) };
    for (const [key, child] of Object.entries(record(override.properties))) {
      properties[key] = merge(record(properties[key]), record(child));
    }
    merged.properties = properties;
  }
  if (base.items && override.items) merged.items = merge(record(base.items), record(override.items));
  return merged;
}

function materialize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(materialize);
  if (value === null || typeof value !== 'object') return value;
  const schema = record(value);
  if (typeof schema.const === 'number') {
    const { const: exact, ...rest } = schema;
    return { ...record(materialize(rest)), type: 'number', minimum: exact, maximum: exact };
  }
  const transformed = { ...schema };
  for (const key of ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']) {
    if (schema[key] && typeof schema[key] === 'object') {
      transformed[key] = Object.fromEntries(Object.entries(record(schema[key])).map(([name, child]) => [name, materialize(child)]));
    }
  }
  for (const key of ['items', 'additionalProperties', 'contains', 'not', 'propertyNames']) {
    if (schema[key] && typeof schema[key] === 'object') transformed[key] = materialize(schema[key]);
  }
  for (const key of ['allOf', 'oneOf', 'prefixItems']) {
    if (Array.isArray(schema[key])) transformed[key] = schema[key].map(materialize);
  }
  if (Array.isArray(schema.anyOf)) {
    const { anyOf: _branches, ...rest } = schema;
    transformed.anyOf = schema.anyOf.map((branch) => materialize(merge(rest, record(branch))));
  }
  // enum/default/const object values are data, not nested schemas.
  return transformed;
}

/** Materialize inherited types and numeric constants for Gemini's tool-schema transport. */
export function prepareCategoryGuidanceModelSchema(schema: Record<string, unknown>): JsonSchema {
  return materialize(schema) as JsonSchema;
}
