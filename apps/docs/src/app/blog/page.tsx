import { getBlogCategories, getBlogPosts } from '@stackarr/cms';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BlogCard } from './BlogCard';
import { BlogPagination } from './BlogPagination';
import { CategoryRail } from './CategoryRail';

const PAGE_SIZE = 9;

type BlogIndexPageProps = { searchParams: Promise<{ page?: string | string[] }> };

function parsePage(value?: string | string[]) {
  const parsed = Number.parseInt(Array.isArray(value) ? value[0] : value || '1', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export async function generateMetadata({ searchParams }: BlogIndexPageProps): Promise<Metadata> {
  const page = parsePage((await searchParams).page);
  const canonical = page === 1 ? '/blog' : `/blog?page=${page}`;

  return {
    title: page === 1 ? 'Homelab Field Notes' : `Homelab Field Notes, Page ${page}`,
    description:
      'Practical guides for safer, more reliable self-hosted systems, media servers, private data, and homelab automation.',
    alternates: {
      canonical,
      types: {
        'application/rss+xml': '/blog/feed.xml',
        'application/feed+json': '/blog/feed.json'
      }
    },
    openGraph: {
      title: page === 1 ? 'Stackarr Homelab Field Notes' : `Stackarr Homelab Field Notes, Page ${page}`,
      description: 'Practical systems thinking for the self-hosted home.',
      url: canonical,
      type: 'website',
      images: ['/blog/opengraph-image']
    },
    twitter: {
      card: 'summary_large_image',
      title: 'Stackarr Homelab Field Notes',
      description: 'Practical systems thinking for the self-hosted home.',
      images: ['/blog/opengraph-image']
    }
  };
}

export default async function BlogPage({ searchParams }: BlogIndexPageProps) {
  const page = parsePage((await searchParams).page);
  const [{ items, total }, categories] = await Promise.all([
    getBlogPosts({ page, pageSize: PAGE_SIZE }),
    getBlogCategories()
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (page > totalPages && total > 0) notFound();
  const lead = page === 1 ? items[0] : undefined;
  const remaining = page === 1 ? items.slice(1) : items;

  return (
    <main className="blogMain">
      <header className="blogMasthead">
        <div>
          <p className="blogKicker">Stackarr Field Notes / Issue {new Date().getUTCFullYear()}</p>
          <h1>Operate the homelab you meant to build.</h1>
        </div>
        <p>
          Clear, source-backed guides for private infrastructure, media, automation, and the systems that keep a home
          server dependable.
        </p>
      </header>
      <CategoryRail categories={categories} />
      {lead ? (
        <section className="blogLead" aria-label="Latest article">
          <BlogCard featured post={lead} />
        </section>
      ) : null}
      <section className="blogIndex" aria-labelledby="latest-articles">
        <div className="blogSectionHead">
          <h2 id="latest-articles">
            {page === 1 ? 'Latest dispatches' : `Archive / ${page.toString().padStart(2, '0')}`}
          </h2>
          <span>{total} articles</span>
        </div>
        {remaining.length ? (
          <div className="blogGrid">
            {remaining.map((post) => (
              <BlogCard key={post._id} post={post} />
            ))}
          </div>
        ) : (
          <div className="blogEmpty">
            <img alt="" src="/icon.svg" />
            <h2>The first field note is being prepared.</h2>
            <p>Subscribe to the RSS feed or return after the editorial publisher completes its first verified run.</p>
          </div>
        )}
        <BlogPagination basePath="/blog" currentPage={page} totalPages={totalPages} />
      </section>
    </main>
  );
}
