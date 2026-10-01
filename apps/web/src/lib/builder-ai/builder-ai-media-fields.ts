const builderAiMediaFields = new Set([
  'avatar',
  'backgroundImage',
  'formEndpoint',
  'image',
  'logo',
  'logoUrl',
  'source',
  'src',
  'upload',
  'video',
]);

export function isBuilderAiMediaField(property: string): boolean {
  return builderAiMediaFields.has(property);
}
