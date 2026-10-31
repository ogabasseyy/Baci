// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  INVALID_UCP_BUSINESS_PROFILE,
  INVALID_UCP_CART,
  INVALID_UCP_LOOKUP_RESPONSE,
  INVALID_UCP_ORDER,
  INVALID_UCP_PLATFORM_CAPABILITY,
  INVALID_UCP_RESPONSE_METADATA,
  INVALID_UCP_SEARCH_RESPONSE,
  VALID_UCP_BUSINESS_PROFILE,
  VALID_UCP_CART,
  VALID_UCP_LOOKUP_RESPONSE,
  VALID_UCP_ORDER,
  VALID_UCP_PLATFORM_CAPABILITY,
  VALID_UCP_RESPONSE_METADATA,
  VALID_UCP_SEARCH_RESPONSE,
} from './ucp-schema-samples';
import {
  canonicalJsonSha256,
  listUcpSchemaFiles,
  readUcpSchemaFile,
  relativeSchemaRefs,
  UCP_FIXTURE_DIR,
  UCP_ROOT_SCHEMA_FILES,
  UCP_SCHEMAS,
  type UcpSchemaRef,
  validateUcpDocument,
} from './ucp-schema-validator';

const PINNED_COMMIT = '9c9d6fce39ffa8bf7cb66309c378b79fb75b5382';

function readManifest(): { commit: string; files: Record<string, string> } {
  return JSON.parse(
    readFileSync(join(UCP_FIXTURE_DIR, 'manifest.json'), 'utf8')
  );
}

describe('vendored UCP 2026-04-08 schemas', () => {
  it('match the manifest hashes regardless of formatting', () => {
    const { files } = readManifest();

    const actual = Object.fromEntries(
      Object.keys(files).map((file) => [
        file,
        canonicalJsonSha256(readFileSync(join(UCP_FIXTURE_DIR, file))),
      ])
    );

    expect(actual).toEqual(files);
  });

  it('hash the parsed JSON, so whitespace changes are ignored', () => {
    expect(canonicalJsonSha256('{"a": [1,\n 2]}')).toBe(
      canonicalJsonSha256('{"a":[1,2]}')
    );
    expect(canonicalJsonSha256('{"a":[1,2]}')).not.toBe(
      canonicalJsonSha256('{"a":[1,3]}')
    );
  });

  it('list exactly the files in the manifest', () => {
    expect(listUcpSchemaFiles()).toEqual(Object.keys(readManifest().files));
  });

  it('contain every file the root schemas reference', () => {
    const vendored = new Set(listUcpSchemaFiles());
    const reached = new Set<string>();
    const queue: string[] = [...UCP_ROOT_SCHEMA_FILES];
    while (queue.length > 0) {
      const file = queue.shift() as string;
      if (reached.has(file)) continue;
      reached.add(file);
      expect(vendored.has(file), `${file} is not vendored`).toBe(true);
      queue.push(...relativeSchemaRefs(file, readUcpSchemaFile(file)));
    }

    expect([...reached].sort()).toEqual([...vendored]);
  });

  it('pin the upstream commit and keep the Apache-2.0 licence', () => {
    expect(readManifest().commit).toBe(PINNED_COMMIT);
    expect(readFileSync(join(UCP_FIXTURE_DIR, 'SOURCE.md'), 'utf8')).toContain(
      PINNED_COMMIT
    );
    expect(readFileSync(join(UCP_FIXTURE_DIR, 'LICENSE'), 'utf8')).toContain(
      'Apache License'
    );
  });
});

describe('validateUcpDocument', () => {
  const samples: Array<{
    invalid: unknown;
    invalidError: string;
    name: string;
    ref: UcpSchemaRef;
    valid: unknown;
  }> = [
    {
      invalid: INVALID_UCP_BUSINESS_PROFILE,
      invalidError: "must have required property 'payment_handlers'",
      name: 'discovery profile (profile_schema.json)',
      ref: UCP_SCHEMAS.businessProfile,
      valid: VALID_UCP_BUSINESS_PROFILE,
    },
    {
      invalid: INVALID_UCP_RESPONSE_METADATA,
      invalidError: 'must match pattern',
      name: 'response metadata (ucp.json)',
      ref: UCP_SCHEMAS.responseCartMetadata,
      valid: VALID_UCP_RESPONSE_METADATA,
    },
    {
      invalid: INVALID_UCP_PLATFORM_CAPABILITY,
      invalidError: "must have required property 'schema'",
      name: 'platform capability (capability.json)',
      ref: UCP_SCHEMAS.platformCapability,
      valid: VALID_UCP_PLATFORM_CAPABILITY,
    },
    {
      invalid: INVALID_UCP_SEARCH_RESPONSE,
      invalidError: 'must be integer',
      name: 'catalog search response (catalog_search.json)',
      ref: UCP_SCHEMAS.catalogSearchResponse,
      valid: VALID_UCP_SEARCH_RESPONSE,
    },
    {
      invalid: INVALID_UCP_LOOKUP_RESPONSE,
      invalidError: "must have required property 'inputs'",
      name: 'catalog lookup response (catalog_lookup.json)',
      ref: UCP_SCHEMAS.catalogLookupResponse,
      valid: VALID_UCP_LOOKUP_RESPONSE,
    },
    {
      invalid: INVALID_UCP_CART,
      invalidError: "must have required property 'price'",
      name: 'cart (cart.json)',
      ref: UCP_SCHEMAS.cart,
      valid: VALID_UCP_CART,
    },
    {
      invalid: INVALID_UCP_ORDER,
      invalidError: 'must contain at least 1 and no more than 1 valid item(s)',
      name: 'order (order.json)',
      ref: UCP_SCHEMAS.order,
      valid: VALID_UCP_ORDER,
    },
  ];

  it.each(samples)('accepts a valid $name sample', ({ ref, valid }) => {
    expect(validateUcpDocument(ref, valid)).toEqual({
      errors: [],
      valid: true,
    });
  });

  it.each(samples)('rejects an invalid $name sample', ({
    invalid,
    invalidError,
    ref,
  }) => {
    const result = validateUcpDocument(ref, invalid);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain(invalidError);
  });

  it('ignores the request-side ucp_request annotation on responses', () => {
    const { errors } = validateUcpDocument(UCP_SCHEMAS.cart, VALID_UCP_CART);

    expect(errors).toEqual([]);
  });
});
