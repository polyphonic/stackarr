import { getBlogCategories, getBlogPostBySlug } from '@stackarr/cms';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getServiceIntegration } from '~/lib/service-integrations';
import { absoluteUrl } from '~/lib/site';
import { formatBlogDate } from '../BlogCard';
import { BlogPortableContent } from '../BlogPortableContent';

const JSON_LD_ESCAPE_RE = /</g;

type BlogPostPageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: BlogPostPageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = await getBlogPostBySlug(slug);
  if (!post) return {};
  const canonical = post.seo?.canonicalUrl || absoluteUrl(`/blog/${post.slug}`);
  const title = post.seo?.title || post.title;
  const description = post.seo?.description || post.excerpt;
  const ogImage = absoluteUrl(`/blog/${post.slug}/opengraph-image`);

  return {
    title,
    description,
    alternates: { canonical },
    keywords: post.tags,
    robots: { index: !post.seo?.noIndex, follow: true },
    openGraph: {
      title: post.seo?.openGraphTitle || title,
      description: post.seo?.openGraphDescription || description,
      type: 'article',
      url: canonical,
      publishedTime: post.publishedAt,
      modifiedTime: post.updatedAt || post._updatedAt,
      authors: post.author?.url ? [post.author.url] : undefined,
      tags: post.tags,
      images: [{ url: ogImage, width: 1200, height: 630, alt: `${post.title} editorial cover` }]
    },
    twitter: {
      card: 'summary_large_image',
      title: post.seo?.openGraphTitle || title,
      description: post.seo?.openGraphDescription || description,
      images: [ogImage]
    }
  };
}

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  const { slug } = await params;
  const [post, categories] = await Promise.all([getBlogPostBySlug(slug), getBlogCategories()]);
  if (!post) notFound();
  const services = post.referencedServices
    .map((serviceSlug) => getServiceIntegration(serviceSlug))
    .filter((service) => Boolean(service));
  const faqItems = post.body
    .filter((block) => block._type === 'faq' && Array.isArray(block.items))
    .flatMap((block) => block.items as Array<Record<string, unknown>>);
  const canonical = post.seo?.canonicalUrl || absoluteUrl(`/blog/${post.slug}`);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BlogPosting',
        headline: post.title,
        description: post.excerpt,
        datePublished: post.publishedAt,
        dateModified: post.updatedAt || post._updatedAt,
        mainEntityOfPage: canonical,
        image: absoluteUrl(`/blog/${post.slug}/opengraph-image`),
        author: { '@type': 'Organization', name: post.author?.name || 'Stackarr Editorial', url: post.author?.url },
        publisher: {
          '@type': 'Organization',
          name: 'Stackarr',
          url: absoluteUrl('/'),
          logo: absoluteUrl('/icon-512.png')
        },
        articleSection: post.category?.title,
        keywords: post.tags.join(', '),
        citation: post.sources.map((source) => source.url)
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: absoluteUrl('/') },
          { '@type': 'ListItem', position: 2, name: 'Blog', item: absoluteUrl('/blog') },
          { '@type': 'ListItem', position: 3, name: post.title, item: canonical }
        ]
      },
      ...(faqItems.length
        ? [
            {
              '@type': 'FAQPage',
              mainEntity: faqItems.map((item) => ({
                '@type': 'Question',
                name: String(item.question ?? ''),
                acceptedAnswer: { '@type': 'Answer', text: String(item.answer ?? '') }
              }))
            }
          ]
        : [])
    ]
  };

  return (
    <main className="blogArticlePage">
      <script
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(JSON_LD_ESCAPE_RE, '\\u003c') }}
        type="application/ld+json"
      />
      <article>
        <header className="blogArticleHeader">
          <nav aria-label="Breadcrumb">
            <a href="/blog">Field Notes</a>
            <span>/</span>
            {post.category ? <a href={`/blog/category/${post.category.slug}`}>{post.category.title}</a> : null}
          </nav>
          <p className="blogKicker">
            {post.contentKind || 'Guide'} / {formatBlogDate(post.publishedAt)}
          </p>
          <h1>{post.title}</h1>
          <p className="blogArticleDek">{post.excerpt}</p>
          <div className="blogArticleByline">
            <span>By {post.author?.name || 'Stackarr Editorial'}</span>
            <span>{post.tags.join(' · ')}</span>
          </div>
        </header>
        {post.coverImage?.url ? (
          <figure className="blogArticleCover">
            <img alt={post.coverImage.alt || post.title} src={post.coverImage.url} />
            {post.coverImage.caption ? <figcaption>{post.coverImage.caption}</figcaption> : null}
          </figure>
        ) : null}
        {services.length ? (
          <aside className="blogArticleServices" aria-label="Services referenced in this article">
            <span>Services in this field note</span>
            <div>
              {services.map((service) =>
                service ? (
                  <a href={`/docs/integrations/${service.slug}`} key={service.slug}>
                    <img alt="" src={`/logos/${service.logo}.${service.logoExtension ?? 'svg'}`} />
                    {service.name}
                  </a>
                ) : null
              )}
            </div>
          </aside>
        ) : null}
        <BlogPortableContent value={post.body} />
        <section className="blogSources">
          <p className="blogKicker">Verification ledger</p>
          <h2>Sources and further reading</h2>
          <ol>
            {post.sources.map((source) => (
              <li key={source._key}>
                <a href={source.url} rel="noopener noreferrer" target="_blank">
                  <strong>{source.title}</strong>
                  <span>
                    {source.publisher} · {source.kind === 'primary' ? 'Primary source' : 'Reference'}
                  </span>
                </a>
              </li>
            ))}
          </ol>
        </section>
        {post.productConnection?.relevant ? (
          <aside className="blogProductConnection">
            <div>
              <p className="blogKicker">Where Stackarr fits</p>
              <h2>{post.productConnection.featureName}</h2>
              <p>{post.productConnection.explanation}</p>
            </div>
            {post.productConnection.docsPath ? (
              <a href={post.productConnection.docsPath}>See the implementation →</a>
            ) : null}
          </aside>
        ) : null}
        <footer className="blogArticleEnd">
          <span>END / {post.slug}</span>
          <a href="/blog">Return to all field notes →</a>
        </footer>
      </article>
      <aside className="blogArticleCategoryIndex">
        <span>Browse by system</span>
        {categories.map((category) => (
          <a href={`/blog/category/${category.slug}`} key={category._id}>
            {category.title}
          </a>
        ))}
      </aside>
    </main>
  );
}
