import 'server-only';

import { safeSanityFetch } from './client';
import { editorialCategories } from './editorial';

export type BlogCategory = {
  _id: string;
  title: string;
  slug: string;
  description: string;
  order: number;
  postCount: number;
};

export type BlogImage = {
  alt?: string;
  caption?: string;
  url?: string;
  asset?: { _ref?: string };
};

export type BlogSource = {
  _key: string;
  title: string;
  publisher: string;
  url: string;
  kind: 'primary' | 'reference' | 'discovery';
};

export type BlogPostSummary = {
  _id: string;
  _updatedAt: string;
  title: string;
  slug: string;
  excerpt: string;
  publishedAt: string;
  updatedAt?: string;
  contentKind?: string;
  tags: string[];
  referencedServices: string[];
  featured?: boolean;
  category?: Omit<BlogCategory, 'postCount'>;
  author?: { name: string; role?: string; bio?: string; url?: string };
  coverImage?: BlogImage;
  seo?: {
    title?: string;
    description?: string;
    canonicalUrl?: string;
    noIndex?: boolean;
    openGraphTitle?: string;
    openGraphDescription?: string;
  };
};

export type BlogPost = BlogPostSummary & {
  body: Array<Record<string, unknown>>;
  sources: BlogSource[];
  productConnection?: {
    relevant?: boolean;
    featureName?: string;
    explanation?: string;
    docsPath?: string;
  };
};

const postSummaryProjection = `
  _id,
  _updatedAt,
  title,
  "slug": slug.current,
  excerpt,
  publishedAt,
  updatedAt,
  contentKind,
  "tags": coalesce(tags, []),
  "referencedServices": coalesce(referencedServices, []),
  featured,
  "category": category->{_id, title, "slug": slug.current, description, order},
  "author": author->{name, role, bio, url},
  coverImage{..., "url": asset->url},
  seo
`;

const fallbackCategories: BlogCategory[] = editorialCategories.map((category, order) => ({
  _id: `category-${category.slug}`,
  ...category,
  order,
  postCount: 0
}));

export async function getBlogCategories(): Promise<BlogCategory[]> {
  const query = `*[_type == "category" && defined(slug.current)] | order(order asc, title asc) {
    _id, title, "slug": slug.current, description, order,
    "postCount": count(*[_type == "post" && references(^._id) && defined(slug.current) && publishedAt <= now() && !coalesce(seo.noIndex, false)])
  }`;
  const categories = await safeSanityFetch<BlogCategory[]>(query, {}, []);
  return categories.length ? categories : fallbackCategories;
}

export async function getBlogPosts(input: { page?: number; pageSize?: number; categorySlug?: string } = {}) {
  const page = Math.max(1, Math.trunc(input.page ?? 1));
  const pageSize = Math.min(24, Math.max(1, Math.trunc(input.pageSize ?? 9)));
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  const categorySlug = input.categorySlug ?? '';
  const filter = `_type == "post" && defined(slug.current) && publishedAt <= now() && !coalesce(seo.noIndex, false) && ($categorySlug == "" || category->slug.current == $categorySlug)`;
  const query = `{
    "items": *[${filter}] | order(featured desc, publishedAt desc) [$start...$end] {${postSummaryProjection}},
    "total": count(*[${filter}])
  }`;

  return safeSanityFetch<{ items: BlogPostSummary[]; total: number }>(
    query,
    { start, end, categorySlug },
    { items: [], total: 0 }
  );
}

export async function getFeaturedBlogPosts(limit = 3) {
  const query = `*[_type == "post" && featured == true && defined(slug.current) && publishedAt <= now() && !coalesce(seo.noIndex, false)]
    | order(publishedAt desc) [0...$limit] {${postSummaryProjection}}`;
  return safeSanityFetch<BlogPostSummary[]>(query, { limit: Math.min(6, Math.max(1, limit)) }, []);
}

export async function getRecentBlogPosts(limit = 50) {
  const query = `*[_type == "post" && defined(slug.current) && publishedAt <= now() && !coalesce(seo.noIndex, false)]
    | order(publishedAt desc) [0...$limit] {${postSummaryProjection}}`;
  return safeSanityFetch<BlogPostSummary[]>(query, { limit: Math.min(100, Math.max(1, limit)) }, []);
}

export async function getBlogPostBySlug(slug: string) {
  const query = `*[_type == "post" && slug.current == $slug && publishedAt <= now() && !coalesce(seo.noIndex, false)][0] {
    ${postSummaryProjection},
    "body": coalesce(body[]{..., _type == "image" => {..., "url": asset->url}}, []),
    "sources": coalesce(sources, []),
    productConnection
  }`;
  return safeSanityFetch<BlogPost | null>(query, { slug }, null);
}

export async function getBlogSitemapEntries() {
  const query = `*[_type == "post" && defined(slug.current) && publishedAt <= now() && !coalesce(seo.noIndex, false)] {
    "slug": slug.current, publishedAt, updatedAt, _updatedAt
  }`;
  return safeSanityFetch<Array<{ slug: string; publishedAt: string; updatedAt?: string; _updatedAt: string }>>(
    query,
    {},
    []
  );
}
