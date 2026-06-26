export type StackarrTheme = 'light' | 'dark' | 'system';

export function getStackarrThemeClass(theme: StackarrTheme): 'light' | 'dark' {
  return theme === 'dark' ? 'dark' : 'light';
}
