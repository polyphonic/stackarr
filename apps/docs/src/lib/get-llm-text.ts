import type { source } from './fumadocs';

const llmTextCache = new Map<string, Promise<string>>();

export function getLLMText(page: ReturnType<typeof source.getPages>[number]) {
  const cached = llmTextCache.get(page.url);

  if (cached) {
    return cached;
  }

  const text = page.data.getText('processed').then(
    (processed: string) => `# ${page.data.title} (${page.url})

${processed}`
  );

  llmTextCache.set(page.url, text);
  return text;
}
