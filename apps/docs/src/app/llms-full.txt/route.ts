import { textHeaders } from '~/lib/discovery';
import { source } from '~/lib/fumadocs';
import { getLLMText } from '~/lib/get-llm-text';

export const dynamic = 'force-static';
export const revalidate = false;

let fullText: Promise<string> | undefined;

function getFullText() {
  fullText ??= Promise.all(source.getPages().map(getLLMText)).then((scanned) => scanned.join('\n\n'));
  return fullText;
}

export async function GET() {
  return new Response(await getFullText(), {
    headers: textHeaders('text/plain; charset=utf-8')
  });
}
