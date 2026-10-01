import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  builderAiEditContract,
  builderAiModelPlanSchema,
  MAX_AI_CANONICAL_SCHEMA_BYTES,
  MAX_AI_CANONICAL_SCHEMA_DEPTH,
} from './index';

function visitSchema(value: unknown, depth = 0): number {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return depth;
  const record = value as Record<string, unknown>;
  const schemaDepth = typeof record.type === 'string' ? depth + 1 : depth;
  if (record.type === 'object') expect(record.additionalProperties).toBe(false);
  expect(record).not.toHaveProperty('unknown');
  const children = [
    ...Object.values((record.properties ?? {}) as Record<string, unknown>),
    record.items,
    ...(Array.isArray(record.oneOf) ? record.oneOf : []),
    ...(Array.isArray(record.anyOf) ? record.anyOf : []),
    ...(Array.isArray(record.allOf) ? record.allOf : []),
  ].filter((child) => child !== undefined);
  return Math.max(
    schemaDepth,
    ...children.map((child) => visitSchema(child, schemaDepth))
  );
}

function assertSupportedKeywords(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  const supported = new Set([
    '$schema',
    '$ref',
    'additionalProperties',
    'allOf',
    'anyOf',
    'const',
    'description',
    'enum',
    'items',
    'maxItems',
    'maximum',
    'maxLength',
    'minItems',
    'minimum',
    'minLength',
    'oneOf',
    'properties',
    'pattern',
    'required',
    'type',
  ]);
  Object.keys(record).forEach((key) => {
    expect(supported.has(key), `unsupported schema key: ${key}`).toBe(true);
  });
  if (typeof record.type === 'string') {
    expect([
      'object',
      'array',
      'string',
      'number',
      'integer',
      'boolean',
      'null',
    ]).toContain(record.type);
  }
  Object.values((record.properties ?? {}) as Record<string, unknown>).forEach(
    assertSupportedKeywords
  );
  if (record.items && !Array.isArray(record.items))
    assertSupportedKeywords(record.items);
  for (const branch of ['oneOf', 'anyOf', 'allOf']) {
    const schemas = record[branch];
    if (Array.isArray(schemas)) schemas.forEach(assertSupportedKeywords);
  }
}

describe('builder AI model plan schema', () => {
  it('audits a closed local Draft 7 schema without exposing a provider schema', () => {
    const auditSchema = z.toJSONSchema(builderAiModelPlanSchema, {
      target: 'draft-07',
      unrepresentable: 'throw',
    });
    const serialized = JSON.stringify(auditSchema);
    expect(serialized.length).toBeLessThanOrEqual(
      MAX_AI_CANONICAL_SCHEMA_BYTES
    );
    expect(visitSchema(auditSchema)).toBeLessThanOrEqual(
      MAX_AI_CANONICAL_SCHEMA_DEPTH
    );
    assertSupportedKeywords(auditSchema);
    expect(builderAiEditContract).not.toHaveProperty('providerSchema');
  });
});
