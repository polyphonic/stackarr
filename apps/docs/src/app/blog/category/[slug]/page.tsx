import { getBlogCategories, getBlogPosts } from '@stackarr/cms';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BlogCard } from '../../BlogCard';
import { BlogPagination } from '../../BlogPagination';
import { CategoryRail } from '../../CategoryRail';
import { parseBlogPage } from '../../pagination';

const PAGE_SIZE = 9;

type CategoryPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
};

export async function generateMetadata({ params, searchParams }: CategoryPageProps): Promise<Metadata> {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const category = (await getBlogCategories()).find((item) => item.slug === slug);
  if (!category) return {};
  const page = parseBlogPage(query.page);
  const canonical = page === 1 ? `/blog/category/${category.slug}` : `/blog/category/${category.slug}?page=${page}`;
  return {
    title: page === 1 ? `${category.title} Homelab Guides` : `${category.title} Homelab Guides, Page ${page}`,
    description: category.description,
    alternates: { canonical },
    openGraph: {
      title:
        page === 1
          ? `${category.title} | Stackarr Field Notes`
          : `${category.title}, Page ${page} | Stackarr Field Notes`,
      description: category.description,
      url: canonical,
      type: 'website',
      images: ['/blog/opengraph-image']
    }
  };
}

export default async function BlogCategoryPage({ params, searchParams }: CategoryPageProps) {
  const [{ slug }, query, categories] = await Promise.all([params, searchParams, getBlogCategories()]);
  const category = categories.find((item) => item.slug === slug);
  if (!category) notFound();
  const page = parseBlogPage(query.page);
  const { items, total } = await getBlogPosts({ page, pageSize: PAGE_SIZE, categorySlug: slug });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (page > totalPages && total > 0) notFound();

  return (
    <main className="blogMain">
      <header className="blogCategoryHeader">
        <p className="blogKicker">Field Notes / Category</p>
        <h1>{category.title}</h1>
        <p>{category.description}</p>
      </header>
      <CategoryRail activeSlug={slug} categories={categories} />
      <section className="blogIndex" aria-label={`${category.title} articles`}>
        <div className="blogSectionHead">
          <h2>Archive</h2>
          <span>{total} articles</span>
        </div>
        {items.length ? (
          <div className="blogGrid">
            {items.map((post) => (
              <BlogCard key={post._id} post={post} />
            ))}
          </div>
        ) : (
          <div className="blogEmpty">
            <h2>No articles in this category yet.</h2>
            <p>Browse all field notes or return soon for a guide in this area.</p>
          </div>
        )}
        <BlogPagination basePath={`/blog/category/${slug}`} currentPage={page} totalPages={totalPages} />
      </section>
    </main>
  );
}
