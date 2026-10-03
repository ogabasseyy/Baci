import { createHash } from 'node:crypto';
import type { LanguageModel } from 'ai';
import { describe, expect, it, vi } from 'vitest';
import { PUBLIC_MCP_TOOLS } from '../../src/config/mcp-server-card-tools';
import { gradeCategoryGuidanceArguments } from './category-guidance-arguments';
import { runCategoryGuidanceModelEval } from './category-guidance-model-eval';
import observedAfter from './category-guidance-model-observed-after.json';
import observedShared from './category-guidance-model-observed-shared.json';
import observedBefore from './category-guidance-model-observed-before.json';
import { prepareCategoryGuidanceModelSchema } from './category-guidance-model-schema';

const mocks = vi.hoisted(() => ({ generateText: vi.fn() }));
vi.mock('ai', async (importOriginal) => ({ ...await importOriginal<typeof import('ai')>(), generateText: mocks.generateText }));

describe('genuine captured model planning arguments', () => {
  it('records all three passing actual calls against the current complete shared descriptor', () => {
    const descriptor = PUBLIC_MCP_TOOLS.find((item) => item.name === 'search_products');
    expect(observedShared.schemaSha256).toBe(createHash('sha256').update(JSON.stringify(descriptor)).digest('hex'));
    expect(observedShared.provenance.worktreeDirty).toBe(true);
    expect(observedShared.cases.map((item) => item.caseId).sort()).toEqual(['camera', 'explicitCategory', 'tecno']);
    for (const item of observedShared.cases) {
      expect(gradeCategoryGuidanceArguments(item.caseId as 'camera' | 'tecno' | 'explicitCategory', item.calls[0].input).passed).toBe(true);
    }
  });
  it('rejects the actual before-guidance omissions and accepts all actual after calls', () => {
    const before = observedBefore.cases.map((item) => gradeCategoryGuidanceArguments(item.caseId as 'camera' | 'tecno' | 'explicitCategory', item.calls[0].input));
    expect(before.map((result) => result.passed)).toEqual([false, true, false]);
    for (const item of observedAfter.cases) {
      expect(gradeCategoryGuidanceArguments(item.caseId as 'camera' | 'tecno' | 'explicitCategory', item.calls[0].input).passed).toBe(true);
    }
  });
});

describe('model invocation boundary (mocked, no live API calls)', () => {
  it('passes current guidance to the model and grades each first call without executing tools', async () => {
    mocks.generateText.mockReset();
    for (const capture of observedAfter.cases) mocks.generateText.mockResolvedValueOnce({ toolCalls: capture.calls, finishReason: 'tool-calls' });
    const result = await runCategoryGuidanceModelEval({} as LanguageModel);
    expect(result.passed).toBe(true);
    expect(mocks.generateText).toHaveBeenCalledTimes(3);
    const options = mocks.generateText.mock.calls[0][0];
    expect(options.maxRetries).toBe(0);
    expect(options.toolChoice).toEqual({ type: 'tool', toolName: 'search_products' });
    expect(options.tools.search_products.execute).toBeUndefined();
    expect(options.tools.search_products.description).toContain('otherwise omit this field');
    expect(options.tools.search_products.description).toContain('include both in intent.alternatives[].brands and intent.alternatives[].model');
  });
  it('rejects missing first calls instead of claiming model success', async () => {
    mocks.generateText.mockReset().mockResolvedValue({ toolCalls: [], finishReason: 'stop' });
    expect((await runCategoryGuidanceModelEval({} as LanguageModel)).passed).toBe(false);
  });
  it('propagates provider failures without retrying or executing tools', async () => {
    mocks.generateText.mockReset().mockRejectedValue(new Error('Unavailable test provider'));
    await expect(runCategoryGuidanceModelEval({} as LanguageModel)).rejects.toThrow('Unavailable test provider');
    expect(mocks.generateText).toHaveBeenCalledTimes(1);
  });
});

describe('Gemini schema transport', () => {
  it('materializes inherited constraints without changing the published descriptor', () => {
    const original = PUBLIC_MCP_TOOLS.find((item) => item.name === 'search_products')?.inputSchema;
    expect(original).toBeDefined();
    const snapshot = JSON.stringify(original);
    const transport = prepareCategoryGuidanceModelSchema(original ?? {});
    expect(JSON.stringify(transport)).not.toContain('"const":0');
    expect(JSON.stringify(transport)).toContain('"minimum":0,"maximum":0');
    expect(JSON.stringify(original)).toBe(snapshot);
    const conditional = prepareCategoryGuidanceModelSchema({ type: 'object', properties: { name: { type: 'string' } }, anyOf: [{ required: ['name'] }] });
    expect(conditional.anyOf?.[0]).toMatchObject({ type: 'object', properties: { name: { type: 'string' } }, required: ['name'] });
  });
});

// Schema slots and example payloads must not be conflated.
describe('schema data preservation', () => {
  it('preserves default/enum payload objects and keyword-named properties', () => {
    const payload = { const: 7, anyOf: [{ required: ['example'] }] };
    const input = { type: 'object', default: payload, enum: [payload], properties: { anyOf: { type: 'string' }, const: { type: 'number' } } };
    const result = prepareCategoryGuidanceModelSchema(input);
    expect(result.default).toEqual(payload);
    expect(result.enum).toEqual([payload]);
    expect(result.properties).toEqual(input.properties);
  });
});
