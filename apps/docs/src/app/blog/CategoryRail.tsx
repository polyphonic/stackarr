import type { BlogCategory } from '@stackarr/cms';

export function CategoryRail({ categories, activeSlug }: { categories: BlogCategory[]; activeSlug?: string }) {
  return (
    <nav className="blogCategoryRail" aria-label="Article categories">
      <a aria-current={!activeSlug ? 'page' : undefined} href="/blog">
        All
      </a>
      {categories.map((category) => (
        <a
          aria-current={activeSlug === category.slug ? 'page' : undefined}
          href={`/blog/category/${category.slug}`}
          key={category._id}
        >
          {category.title}
          {category.postCount ? <sup>{category.postCount}</sup> : null}
        </a>
      ))}
    </nav>
  );
}
