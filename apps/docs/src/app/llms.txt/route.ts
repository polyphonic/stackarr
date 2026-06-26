import { llms } from 'fumadocs-core/source/llms';
import { textHeaders } from '~/lib/discovery';
import { source } from '~/lib/fumadocs';

export const dynamic = 'force-static';
export const revalidate = false;

const llmsIndex = llms(source).index();

export function GET() {
  return new Response(llmsIndex, {
    headers: textHeaders('text/plain; charset=utf-8')
  });
}
