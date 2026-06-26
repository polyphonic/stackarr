export const portablePasswordPattern = /^[A-Za-z0-9._-]+$/;
export const portablePasswordDescription = 'letters, numbers, dot, underscore, and hyphen';
export const portablePasswordMinimumLength = 8;

export function portablePasswordValidationError(password: string | undefined, label = 'Password') {
  if (!password) {
    return undefined;
  }

  if (password.length < portablePasswordMinimumLength) {
    return `${label} must be at least ${portablePasswordMinimumLength} characters.`;
  }

  if (!portablePasswordPattern.test(password)) {
    return `${label} may only use ${portablePasswordDescription}.`;
  }

  return undefined;
}
