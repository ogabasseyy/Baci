function isBatteryHealthValue(token: string) {
  return /^\d{2,3}$/u.test(token);
}

/** Removes used-device grading text without removing the product model or storage. */
export function stripUsedDeviceConditionMetadata(tokens: string[]) {
  const normalized: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? '';
    const next = tokens[index + 1] ?? '';
    const afterNext = tokens[index + 2] ?? '';

    if (
      isBatteryHealthValue(token) &&
      next === 'battery' &&
      afterNext === 'health'
    ) {
      index += 2;
      continue;
    }
    if (token === 'battery' && next === 'health') {
      index += 1;
      continue;
    }
    if (token === 'grade' && /^[a-c]$/u.test(next)) {
      index += 1;
      continue;
    }

    normalized.push(token);
  }

  return normalized;
}
