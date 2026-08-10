import type { BlogPostSummary } from '@stackarr/cms';
import { getServiceIntegration } from '~/lib/service-integrations';

const DATE_FORMATTER = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' });

export function formatBlogDate(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : DATE_FORMATTER.format(date);
}

export function BlogCard({ post, featured = false }: { post: BlogPostSummary; featured?: boolean }) {
  const services = (post.referencedServices ?? [])
    .map((slug) => getServiceIntegration(slug))
    .filter((service) => Boolean(service));

  return (
    <article className={featured ? 'blogCard blogCardFeatured' : 'blogCard'}>
      <a className="blogCardImage" href={`/blog/${post.slug}`} aria-label={`Read ${post.title}`}>
        {post.coverImage?.url ? (
          <img alt={post.coverImage.alt || post.title} src={post.coverImage.url} />
        ) : (
          <span className="blogImageFallback" aria-hidden="true">
            <img alt="" src="/icon.svg" />
          </span>
        )}
        <span className="blogCardIndex">{featured ? 'FIELD NOTE' : post.contentKind?.toUpperCase() || 'GUIDE'}</span>
      </a>
      <div className="blogCardBody">
        <div className="blogCardMeta">
          {post.category ? <a href={`/blog/category/${post.category.slug}`}>{post.category.title}</a> : null}
          <time dateTime={post.publishedAt}>{formatBlogDate(post.publishedAt)}</time>
        </div>
        <h2>
          <a href={`/blog/${post.slug}`}>{post.title}</a>
        </h2>
        <p>{post.excerpt}</p>
        <div className="blogCardFoot">
          <span>Read article ↗</span>
          {services.length ? (
            <span className="blogServiceMarks" aria-label="Referenced services">
              {services
                .slice(0, 4)
                .map((service) =>
                  service ? (
                    <img
                      alt={service.name}
                      key={service.slug}
                      src={`/logos/${service.logo}.${service.logoExtension ?? 'svg'}`}
                      title={service.name}
                    />
                  ) : null
                )}
            </span>
          ) : null}
        </div>
      </div>
    </article>
  );
}
