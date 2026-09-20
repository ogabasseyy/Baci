/**
 * Valid-Date assertion for the savings-policy modules. Invalid comparison
 * instants must fail closed rather than silently decide.
 *
 * Internal to the policy barrel: imported by sibling modules, not
 * re-exported publicly.
 */
export function assertValidDate(value: Date, name: string): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new RangeError(`${name} must be a valid Date`);
  }
}
