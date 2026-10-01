export function createBuilderComponentId(componentType: string): string {
  return `${componentType.toLowerCase()}-${crypto.randomUUID()}`;
}
