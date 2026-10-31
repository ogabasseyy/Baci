import type { ErrorObject } from 'ajv';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { listUcpSchemaFiles } from './list-ucp-schema-files';
import { readUcpSchemaFile } from './read-ucp-schema-file';

// The schemas' $id values are identifiers, not downloadable pages (the
// unversioned URLs return 404), so only the origin appears as a literal.
const ID_ORIGIN = 'https://ucp.dev';

/** Schema references a caller can validate a payload against. */
export const UCP_SCHEMAS = {
  businessProfile: `${ID_ORIGIN}/discovery/profile.json`,
  cart: `${ID_ORIGIN}/schemas/shopping/cart.json`,
  catalogLookupResponse: `${ID_ORIGIN}/schemas/shopping/catalog_lookup.json#/$defs/lookup_response`,
  catalogSearchResponse: `${ID_ORIGIN}/schemas/shopping/catalog_search.json#/$defs/search_response`,
  order: `${ID_ORIGIN}/schemas/shopping/order.json`,
  platformCapability: `${ID_ORIGIN}/schemas/capability.json#/$defs/platform_schema`,
  responseCartMetadata: `${ID_ORIGIN}/schemas/ucp.json#/$defs/response_cart_schema`,
} as const;

export type UcpSchemaRef = (typeof UCP_SCHEMAS)[keyof typeof UCP_SCHEMAS];

interface UcpValidationResult {
  readonly errors: string[];
  readonly valid: boolean;
}

const PROFILE_FILE = 'discovery/profile_schema.json';
// Upstream declares this schema's $id as .../schemas/discovery/profile.json
// while its own $refs ("../schemas/ucp.json") assume it sits one level higher.
// Registering it under the matching base keeps every reference local.
const PROFILE_BASE_URI = `${ID_ORIGIN}/discovery/profile.json`;

function createAjv(): Ajv2020 {
  // UCP schemas use `required` without `properties` in allOf branches and
  // `properties` without `type` in conditional branches. Both are legal, so
  // the strictRequired and strictTypes lints are off; unknown keywords still
  // fail, apart from the two annotations registered below.
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
    strictTypes: false,
  });
  addFormats(ajv);
  // `ucp_request` marks per-operation request presence ("omit", "optional",
  // "required", or {create, update, complete}). This validator checks RESPONSE
  // payloads, where the schema is read as written and the annotation does not
  // apply. A request validator must resolve it per operation first.
  ajv.addKeyword({ keyword: 'ucp_request' });
  // Capability schemas carry their reverse-domain name in a root `name`.
  ajv.addKeyword({ keyword: 'name' });
  for (const file of listUcpSchemaFiles()) {
    const schema = readUcpSchemaFile(file) as Record<string, unknown>;
    ajv.addSchema(
      file === PROFILE_FILE ? { ...schema, $id: PROFILE_BASE_URI } : schema
    );
  }
  return ajv;
}

let sharedAjv: Ajv2020 | undefined;

function describeError(error: ErrorObject): string {
  return `${error.instancePath || '(root)'} ${error.message ?? 'is invalid'}`;
}

/** Validates a UCP response payload against a vendored 2026-04-08 schema. */
export function validateUcpDocument(
  schemaRef: UcpSchemaRef,
  document: unknown
): UcpValidationResult {
  sharedAjv ??= createAjv();
  const validate = sharedAjv.getSchema(schemaRef);
  if (!validate) {
    throw new Error(`Unknown UCP schema reference: ${schemaRef}`);
  }
  const valid = validate(document) as boolean;
  return {
    errors: valid ? [] : (validate.errors ?? []).map(describeError),
    valid,
  };
}
