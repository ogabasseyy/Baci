import {
  getManifestComponentSchema,
  getManifestNamedComponentPatchSchema,
} from './manifest-component-schema';

export const productGridPatchSchema =
  getManifestNamedComponentPatchSchema('ProductGrid');

export const insertableComponentSchema = getManifestComponentSchema('insert');
