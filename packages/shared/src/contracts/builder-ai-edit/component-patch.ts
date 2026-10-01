import { getManifestComponentSchema } from './manifest-component-schema';

export const componentPatchSchema = getManifestComponentSchema('edit');

export type BuilderAiComponentPatch = Record<string, unknown> & {
  componentType: string;
};
