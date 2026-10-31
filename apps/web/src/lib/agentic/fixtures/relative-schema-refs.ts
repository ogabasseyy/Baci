import { posix } from 'node:path';

/** Files a schema references through relative $ref values (fragments dropped). */
export function relativeSchemaRefs(file: string, schema: unknown): string[] {
  const refs = new Set<string>();
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') {
        const [target] = value.split('#');
        if (target && !/^[a-z][a-z0-9+.-]*:/i.test(target)) {
          refs.add(posix.normalize(posix.join(posix.dirname(file), target)));
        }
      } else {
        visit(value);
      }
    }
  };
  visit(schema);
  return [...refs].sort();
}
