import { expect, it } from 'vitest';
import {
  experienceSdkOutputSchema,
  experienceWireInputs,
  experienceWireOutput,
  listedExperienceSchemas,
} from './experience-contracts';

it('initializes all experience Zod contracts using the installed JSON Schema converter', () => {
  for (const schema of Object.values(experienceWireInputs))
    expect(typeof schema.safeParse).toBe('function');
  expect(
    experienceWireInputs.finalize_experience_build.safeParse({
      privateField: true,
    }).success
  ).toBe(false);
  expect(
    experienceWireOutput.safeParse({ status: 'invented', secret: true }).success
  ).toBe(false);
  expect(
    listedExperienceSchemas('finalize_experience_build').inputSchema.type
  ).toBe('object');
  expect(
    experienceSdkOutputSchema()['~standard'].jsonSchema.output().type
  ).toBe('object');
});
