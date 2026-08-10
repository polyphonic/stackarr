import type { BlogPost, BlogPostSummary } from './queries';

function escapeMarkdown(value: string) {
  return value.replace(/([\\`*_{}\[\]<>#+.!|-])/g, '\\$1');
}

function spanText(span: Record<string, unknown>, markDefs: Array<Record<string, unknown>>) {
  const text = String(span.text ?? '');
  const marks = Array.isArray(span.marks) ? span.marks.map(String) : [];
  const linkMark = marks
    .map((mark) => markDefs.find((definition) => definition._key === mark))
    .find((definition) => definition?._type === 'link');
  const href = linkMark && typeof linkMark.href === 'string' ? linkMark.href : null;
  let output = escapeMarkdown(text);
  if (marks.includes('strong')) output = `**${output}**`;
  if (marks.includes('em')) output = `_${output}_`;
  if (marks.includes('code')) output = `\`${output}\``;
  return href ? `[${output}](${href})` : output;
}

function blockText(block: Record<string, unknown>) {
  const markDefs = Array.isArray(block.markDefs) ? (block.markDefs as Array<Record<string, unknown>>) : [];
  const children = Array.isArray(block.children) ? (block.children as Array<Record<string, unknown>>) : [];
  return children.map((span) => spanText(span, markDefs)).join('');
}

export function blogPostToMarkdown(post: BlogPost) {
  const body = post.body
    .map((block) => {
      if (block._type === 'block') {
        const text = blockText(block);
        if (block.listItem === 'bullet') return `- ${text}`;
        if (block.listItem === 'number') return `1. ${text}`;
        if (block.style === 'h2') return `## ${text}`;
        if (block.style === 'h3') return `### ${text}`;
        if (block.style === 'h4') return `#### ${text}`;
        if (block.style === 'blockquote') return `> ${text}`;
        return text;
      }
      if (block._type === 'callout') {
        return `> **${escapeMarkdown(String(block.title ?? 'Note'))}**\n> ${escapeMarkdown(String(block.body ?? ''))}`;
      }
      if (block._type === 'codeBlock') {
        return `\`\`\`${String(block.language ?? 'text')}\n${String(block.code ?? '')}\n\`\`\``;
      }
      if (block._type === 'faq' && Array.isArray(block.items)) {
        return (block.items as Array<Record<string, unknown>>)
          .map(
            (item) =>
              `### ${escapeMarkdown(String(item.question ?? ''))}\n\n${escapeMarkdown(String(item.answer ?? ''))}`
          )
          .join('\n\n');
      }
      if (block._type === 'image' && typeof block.url === 'string') {
        return `![${escapeMarkdown(String(block.alt ?? ''))}](${block.url})`;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n\n');

  const sources = post.sources
    .map((source) => `- [${escapeMarkdown(source.title)}](${source.url}) — ${escapeMarkdown(source.publisher)}`)
    .join('\n');

  return `# ${escapeMarkdown(post.title)}\n\n${escapeMarkdown(post.excerpt)}\n\n${body}\n\n## Sources and further reading\n\n${sources}\n`;
}

export function blogIndexToMarkdown(posts: BlogPostSummary[]) {
  const items = posts
    .map((post) => `- [${escapeMarkdown(post.title)}](/blog/${post.slug}) — ${escapeMarkdown(post.excerpt)}`)
    .join('\n');
  return `# Stackarr Blog\n\nPractical guides for safer, more reliable self-hosted systems.\n\n${items || 'No articles are published yet.'}\n`;
}
