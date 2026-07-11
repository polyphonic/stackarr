export const siteName = 'Stackarr';
export const siteUrl = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '') ||
  'https://stackarr.app'
).replace(/\/$/, '');

export const siteDescription =
  'Stackarr gives AI agents a safety-controlled, local-first control plane for managing self-hosted apps and private homelabs from chat.';

export const githubRepo = 'polyphonic/stackarr';
export const githubUrl = process.env.NEXT_PUBLIC_GITHUB_URL || `https://github.com/${githubRepo}`;
export const googleTagManagerId = 'GTM-MZ5T4FZH';
export const siteVersion = '0.3.0-alpha.1';

export function absoluteUrl(path = '/') {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${siteUrl}${normalizedPath}`;
}
