import { notFound } from 'next/navigation';
import { markdownResponse } from '~/lib/discovery';
import { source } from '~/lib/fumadocs';
import { getLLMText } from '~/lib/get-llm-text';

export const dynamic = 'force-static';
export const revalidate = false;

export async function GET(_request: Request, { params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  const page = source.getPage(slug);

  if (!page) {
    notFound();
  }

  return markdownResponse(await getLLMText(page));
}

export function generateStaticParams() {
  return source.generateParams();
}
