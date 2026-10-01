export function resolve(specifier, context, nextResolve) {
  if (specifier === 'typescript') {
    return nextResolve('@typescript/typescript6', context);
  }

  return nextResolve(specifier, context);
}
