const RECENT_CATEGORY_WINDOW = 2;

export function validateCategoryFreshness(categorySlug, recentPosts) {
  const recentCategorySlugs = recentPosts
    .map((post) => post?.categorySlug)
    .filter((slug) => typeof slug === 'string' && slug.length > 0)
    .slice(0, RECENT_CATEGORY_WINDOW);

  return {
    valid: !recentCategorySlugs.includes(categorySlug),
    recentCategorySlugs
  };
}
