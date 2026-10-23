import { expect, it } from 'vitest';
import {
  builderSdkOutputSchema,
  builderWireInputs,
  builderWireOutputs,
  listedBuilderSchemas,
} from './contracts';

it('advertises object roots while retaining strict output validation', () => {
  const name = 'list_storefronts';
  expect(listedBuilderSchemas(name).inputSchema.type).toBe('object');
  expect(
    builderSdkOutputSchema(name)['~standard'].jsonSchema.output().type
  ).toBe('object');
  expect(
    builderWireInputs[name].safeParse({ privateField: true }).success
  ).toBe(false);
  expect(
    builderWireOutputs[name].safeParse({ stores: [], nextCursor: null }).success
  ).toBe(true);
  expect(
    builderWireOutputs[name].safeParse({
      stores: [],
      nextCursor: null,
      privateField: true,
    }).success
  ).toBe(false);
});
