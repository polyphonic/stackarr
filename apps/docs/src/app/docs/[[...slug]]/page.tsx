import { DocsBody, DocsPage } from 'fumadocs-ui/page';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { source } from '~/lib/fumadocs';
import { absoluteUrl, siteName } from '~/lib/site';
import { getMDXComponents } from '~/mdx-components';

export default async function Page(props: { params: Promise<{ slug?: string[] }> }) {
  const params = await props.params;
  const page = source.getPage(params.slug);

  if (!page) {
    notFound();
  }

  const Mdx = page.data.body;

  return (
    <DocsPage toc={page.data.toc}>
      <DocsBody>
        <Mdx components={getMDXComponents()} />
      </DocsBody>
    </DocsPage>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: { params: Promise<{ slug?: string[] }> }): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);

  if (!page) {
    notFound();
  }

  return {
    title: page.data.title,
    description: page.data.description,
    alternates: {
      canonical: page.url
    },
    openGraph: {
      title: page.data.title,
      description: page.data.description,
      url: page.url,
      siteName,
      type: 'article',
      images: [
        {
          url: absoluteUrl('/icon-512.png'),
          width: 512,
          height: 512,
          alt: 'Stackarr logo'
        }
      ]
    }
  };
}
