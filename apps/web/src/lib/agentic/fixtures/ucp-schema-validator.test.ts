// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { VALID_UCP_CART } from './ucp-schema-samples';
import { UCP_SCHEMAS, validateUcpDocument } from './ucp-schema-validator';

describe('validateUcpDocument', () => {
  it('ignores the request-side ucp_request annotation on responses', () => {
    const { errors } = validateUcpDocument(UCP_SCHEMAS.cart, VALID_UCP_CART);

    expect(errors).toEqual([]);
  });
});
