import { parseCapturedDocument } from './capture-document';
import { CAPTURE_LIMITS } from './capture-public-contract';

const AUTH_URL = 'https://chowdeck-api.readme.io/reference/authentication-1.md';
const CATEGORY_URL =
  'https://chowdeck-api.readme.io/reference/create-menu-category.md';

function categoryMarkdown(discarded: string): string {
  return `\`\`\`json
{"openapi":"3.1.0","paths":{"/merchant/{merchantReference}/menucategory":{"post":{"discarded":${discarded},"requestBody":{"content":{"application/json":{"schema":{"properties":{"name":{"type":"string"},"reference":{"type":"string"}},"required":["name","reference"],"type":"object"}}}}}}}}
\`\`\``;
}

function parseJson(serialized: string, parsedNodes = 100) {
  return parseCapturedDocument({
    bytes: new TextEncoder().encode(serialized),
    contentType: 'application/json',
    expectedCapability: 'authentication',
    sourceUrl: AUTH_URL,
    limits: { ...CAPTURE_LIMITS, parsedNodes },
  });
}

describe('captured document parsing', () => {
  it('does not traverse an inherited contractEvidence value', () => {
    const claim = JSON.stringify({ status: 'documented' });

    const parsed = parseJson(`{"__proto__":{"contractEvidence":${claim}}}`);

    expect(parsed.claim).toBeUndefined();
    expect(parsed.nodes).toBeGreaterThan(2);
  });

  it('counts nested __proto__ content against parsed-node limits', () => {
    const serialized = `{"__proto__":{"nested":[${new Array(8).fill('null').join(',')}]}}`;

    expect(() => parseJson(serialized, 5)).toThrow('capture limit exceeded');
  });

  it('recognizes bounded Markdown without retaining its source text', () => {
    const parsed = parseCapturedDocument({
      bytes: new TextEncoder().encode(
        '# Authentication\n\nAuthorization scheme: Bearer.'
      ),
      contentType: 'text/markdown',
      expectedCapability: 'authentication',
      sourceUrl: AUTH_URL,
      limits: CAPTURE_LIMITS,
    });

    expect(parsed.claim).toMatchObject({
      authScheme: 'bearer',
      status: 'documented',
    });
    expect(parsed).not.toHaveProperty('text');
  });

  it.each([
    [
      '20,001 discarded JSON nodes',
      `[${new Array(CAPTURE_LIMITS.parsedNodes + 1).fill('null').join(',')}]`,
    ],
    [
      '33 nested JSON arrays',
      `${'['.repeat(CAPTURE_LIMITS.maxDepth + 1)}0${']'.repeat(CAPTURE_LIMITS.maxDepth + 1)}`,
    ],
  ])('applies capture ceilings to fenced OpenAPI with %s', (_label, value) => {
    expect(() =>
      parseCapturedDocument({
        bytes: new TextEncoder().encode(categoryMarkdown(value)),
        contentType: 'text/markdown',
        expectedCapability: 'menu.category.create',
        sourceUrl: CATEGORY_URL,
        limits: CAPTURE_LIMITS,
      })
    ).toThrow('capture limit exceeded');
  });
  it('rejects extremely deep fenced JSON rather than ignoring a parser overflow', () => {
    const text = `# Authentication\nAuthorization scheme: Bearer.\n\`\`\`json\n${'['.repeat(10_000)}0${']'.repeat(10_000)}\n\`\`\``;
    expect(() =>
      parseCapturedDocument({
        bytes: new TextEncoder().encode(text),
        contentType: 'text/markdown',
        expectedCapability: 'authentication',
        sourceUrl: AUTH_URL,
        limits: CAPTURE_LIMITS,
      })
    ).toThrow('capture limit exceeded');
  });
});
