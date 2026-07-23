export const portablePasswordMinimumLength = 8;
export const portablePasswordMaximumLength = 256;
export const accountUsernamePattern = /^[A-Za-z0-9._-]+$/;
export const accountUsernameDescription = 'letters, numbers, dot, underscore, and hyphen';
export const accountUsernameMaximumLength = 64;

export function accountUsernameValidationError(username: string | undefined, label = 'Username') {
  if (!username) {
    return `${label} is required.`;
  }

  if (username.length > accountUsernameMaximumLength) {
    return `${label} must be ${accountUsernameMaximumLength} characters or fewer.`;
  }

  if (!accountUsernamePattern.test(username)) {
    return `${label} may only use ${accountUsernameDescription}.`;
  }

  return undefined;
}

export function portablePasswordValidationError(password: string | undefined, label = 'Password') {
  if (!password) {
    return undefined;
  }

  if (password.length < portablePasswordMinimumLength) {
    return `${label} must be at least ${portablePasswordMinimumLength} characters.`;
  }

  if (password.length > portablePasswordMaximumLength) {
    return `${label} must be ${portablePasswordMaximumLength} characters or fewer.`;
  }

  if (password.includes('\0')) {
    return `${label} cannot contain a null character.`;
  }

  return undefined;
}
