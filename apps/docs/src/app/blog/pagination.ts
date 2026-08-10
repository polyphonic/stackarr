export function parseBlogPage(value?: string | string[]) {
  const parsed = Number.parseInt(Array.isArray(value) ? value[0] : value || '1', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}
