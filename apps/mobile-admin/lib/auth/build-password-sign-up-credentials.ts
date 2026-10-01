interface BuildPasswordSignUpCredentialsInput {
  attemptId: string;
  email: string;
  firstName?: string;
  fullName?: string;
  lastName?: string;
  password: string;
  signupFlow: 'merchant' | 'staff';
}

function toSentenceCase(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;

  return `${normalized.charAt(0).toUpperCase()}${normalized
    .slice(1)
    .toLowerCase()}`;
}

export function buildPasswordSignUpCredentials({
  attemptId,
  email,
  firstName,
  fullName,
  lastName,
  password,
  signupFlow,
}: BuildPasswordSignUpCredentialsInput) {
  const normalizedFirstName = toSentenceCase(firstName);
  const normalizedLastName = toSentenceCase(lastName);
  const normalizedFullName =
    [normalizedFirstName, normalizedLastName].filter(Boolean).join(' ') ||
    fullName
      ?.trim()
      .split(/\s+/)
      .map((part) => toSentenceCase(part))
      .filter(Boolean)
      .join(' ');

  return {
    email,
    password,
    options: {
      data: {
        ...(normalizedFirstName ? { first_name: normalizedFirstName } : {}),
        ...(normalizedLastName ? { last_name: normalizedLastName } : {}),
        ...(normalizedFullName ? { full_name: normalizedFullName } : {}),
        signup_attempt_id: attemptId,
        signup_flow: signupFlow,
      },
    },
  };
}
