const alphabeticalOptions: Intl.CollatorOptions = {
  numeric: true,
  sensitivity: 'base'
};

export function compareAlphabeticalLabels(left: string, right: string) {
  return left.localeCompare(right, 'en', alphabeticalOptions);
}

export function compareServicesByDisplayName(left: { displayName: string }, right: { displayName: string }) {
  return compareAlphabeticalLabels(left.displayName, right.displayName);
}
