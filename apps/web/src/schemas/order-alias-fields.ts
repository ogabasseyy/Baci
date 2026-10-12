/**
 * Shared camelCase/snake_case alias helpers for order schemas.
 *
 * Split out of orders.ts (Boy Scout Rule): the order-item offer refinements
 * live in their own module and need the same match/message helpers without
 * importing the whole order schema back.
 */
export function matchingAliasFields<Left extends string, Right extends string>(
  left: Left,
  right: Right
) {
  return (data: { [Key in Left | Right]?: unknown }) => {
    const leftValue = data[left];
    const rightValue = data[right];

    return !leftValue || !rightValue || leftValue === rightValue;
  };
}

export function aliasFieldsMismatchMessage(left: string, right: string) {
  return `${left} and ${right} must match when both are provided`;
}
