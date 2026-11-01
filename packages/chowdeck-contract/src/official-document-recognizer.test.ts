import { parseCapturedDocument } from './capture-document';
import { CAPTURE_LIMITS } from './capture-public-contract';

const CATEGORY_URL =
  'https://chowdeck-api.readme.io/reference/create-menu-category.md';
const AUTH_URL = 'https://chowdeck-api.readme.io/reference/authentication-1.md';
const GUIDE_URL = 'https://chowdeck-api.readme.io/docs/managing-your-menu.md';
const REFERENCE_ROOT = 'https://chowdeck-api.readme.io/reference';

function parseMarkdown(
  text: string,
  capability: Parameters<typeof parseCapturedDocument>[0]['expectedCapability'],
  sourceUrl: string
) {
  return parseCapturedDocument({
    bytes: new TextEncoder().encode(text),
    contentType: 'text/markdown',
    expectedCapability: capability,
    sourceUrl,
    limits: CAPTURE_LIMITS,
  });
}

function categoryOpenApi(method = 'post', type = 'string'): string {
  return `# Create Menu Category

\`\`\`json
{"openapi":"3.1.0","paths":{"/merchant/{merchantReference}/menucategory":{"${method}":{"requestBody":{"content":{"application/json":{"schema":{"properties":{"name":{"type":"${type}"},"reference":{"type":"string"}},"required":["name","reference"],"type":"object"}}}}}}}}
\`\`\`
`;
}

function operationOpenApi(input: {
  method: 'get' | 'post';
  path: string;
  properties?: string;
  required?: string;
}): string {
  const requestBody =
    input.properties === undefined
      ? ''
      : `,"requestBody":{"content":{"application/json":{"schema":{"properties":{${input.properties}},"required":[${input.required ?? ''}],"type":"object"}}}}`;
  return `\`\`\`json
{"openapi":"3.1.0","paths":{"${input.path}":{"${input.method}":{"responses":{}${requestBody}}}}}
\`\`\``;
}

describe('official document recognizer', () => {
  it.each([
    [
      'account.read',
      `${REFERENCE_ROOT}/get-merchant-profile.md`,
      operationOpenApi({ method: 'get', path: '/merchant/' }),
      [],
    ],
    [
      'menu.category.create',
      `${REFERENCE_ROOT}/create-menu-category.md`,
      operationOpenApi({
        method: 'post',
        path: '/merchant/{merchantReference}/menucategory',
        properties: '"name":{"type":"string"},"reference":{"type":"string"}',
        required: '"name","reference"',
      }),
      ['name', 'reference'],
    ],
    [
      'menu.category.list',
      `${REFERENCE_ROOT}/list-menu-categories.md`,
      operationOpenApi({
        method: 'get',
        path: '/merchant/{merchantReference}/menucategory',
      }),
      [],
    ],
    [
      'menu.item.create',
      `${REFERENCE_ROOT}/create-menu-item.md`,
      operationOpenApi({
        method: 'post',
        path: '/merchant/{merchantReference}/menu',
        properties:
          '"description":{"type":"string"},"images":{"type":"array"},"in_stock":{"type":"boolean"},"menu_category_id":{"type":"integer"},"name":{"type":"string"},"path":{"type":"string"},"price":{"type":"integer"},"reference":{"type":"string"}',
        required:
          '"in_stock","menu_category_id","name","path","price","reference"',
      }),
      [
        'description',
        'images',
        'in_stock',
        'menu_category_id',
        'name',
        'path',
        'price',
        'reference',
      ],
    ],
    [
      'menu.item.list',
      `${REFERENCE_ROOT}/list-menu-items.md`,
      operationOpenApi({
        method: 'get',
        path: '/merchant/{merchantReference}/menu',
      }),
      [],
    ],
    [
      'menu.item.read',
      `${REFERENCE_ROOT}/get-menu-item.md`,
      operationOpenApi({
        method: 'get',
        path: '/merchant/{merchantReference}/menu/{menuReference}',
      }),
      [],
    ],
  ] as const)('recognizes the approved %s OpenAPI shape', (capability, sourceUrl, markdown, expectedFieldNames) => {
    const parsed = parseMarkdown(markdown, capability, sourceUrl);

    expect(parsed.claim).toMatchObject({ status: 'documented' });
    expect(parsed.claim?.requestFields.map(({ name }) => name)).toEqual(
      expectedFieldNames
    );
    expect(parsed.claim?.responseFields).toEqual([]);
  });

  it('extracts only approved operation and request-shape metadata from OpenAPI', () => {
    const parsed = parseMarkdown(
      categoryOpenApi(),
      'menu.category.create',
      CATEGORY_URL
    );

    expect(parsed.claim).toMatchObject({
      status: 'documented',
      authScheme: 'unproven',
      pagination: 'not_applicable',
      operation: {
        method: 'post',
        pathTemplate: '/merchant/{merchantReference}/menucategory',
      },
      requestFields: [
        { name: 'name', type: 'string', required: true },
        { name: 'reference', type: 'string', required: true },
      ],
      responseFields: [],
    });
  });

  it('does not stop limit inspection after an earlier recognized fence', () => {
    const discarded = JSON.stringify({
      ignored: new Array(CAPTURE_LIMITS.parsedNodes + 1).fill(null),
    });
    const laterFence = `\n\`\`\`json\n${discarded}\n\`\`\``;

    expect(() =>
      parseMarkdown(
        `${categoryOpenApi()}${laterFence}`,
        'menu.category.create',
        CATEGORY_URL
      )
    ).toThrow('capture limit exceeded');
  });

  it.each([
    ['wrong method', categoryOpenApi('put')],
    ['wrong field type', categoryOpenApi('post', 'integer')],
    ['source prose without OpenAPI', '# Create Menu Category'],
  ])('leaves the claim unproven for %s', (_label, markdown) => {
    expect(
      parseMarkdown(markdown, 'menu.category.create', CATEGORY_URL).claim
    ).toBeUndefined();
  });

  it('documents bearer only from an explicit authorization scheme declaration', () => {
    const parsed = parseMarkdown(
      '# Authentication\n\nAuthorization scheme: Bearer.',
      'authentication',
      AUTH_URL
    );

    expect(parsed.claim).toMatchObject({
      status: 'documented',
      authScheme: 'bearer',
      operation: { status: 'not_applicable' },
    });
  });

  it('does not infer the auth scheme from a standalone Bearer occurrence', () => {
    const parsed = parseMarkdown(
      '# Authentication\n\nBearer appears without a scheme declaration.',
      'authentication',
      AUTH_URL
    );

    expect(parsed.claim).toBeUndefined();
  });

  it('documents the exact menu guide heading without claiming an operation', () => {
    const parsed = parseMarkdown(
      '# Managing Your Menu',
      'menu.manage',
      GUIDE_URL
    );

    expect(parsed.claim).toMatchObject({
      status: 'documented',
      operation: { status: 'not_applicable' },
      requestFields: [],
      responseFields: [],
    });
  });
});
