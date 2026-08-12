import assert from 'node:assert/strict';
import test from 'node:test';
import { validateCategoryFreshness } from './lib/publisher-policy.mjs';

test('rejects a category used by either of the two most recent articles', () => {
  const recentPosts = [
    { categorySlug: 'infrastructure-networking' },
    { categorySlug: 'data-photos' },
    { categorySlug: 'media-entertainment' }
  ];

  assert.deepEqual(validateCategoryFreshness('infrastructure-networking', recentPosts), {
    valid: false,
    recentCategorySlugs: ['infrastructure-networking', 'data-photos']
  });
  assert.deepEqual(validateCategoryFreshness('data-photos', recentPosts), {
    valid: false,
    recentCategorySlugs: ['infrastructure-networking', 'data-photos']
  });
});

test('accepts a category not used by the two most recent articles', () => {
  const recentPosts = [{ categorySlug: 'infrastructure-networking' }, { categorySlug: 'data-photos' }];

  assert.deepEqual(validateCategoryFreshness('gaming-emulation', recentPosts), {
    valid: true,
    recentCategorySlugs: ['infrastructure-networking', 'data-photos']
  });
});

test('does not substitute an older category when a recent post has no category', () => {
  const recentPosts = [{ categorySlug: 'infrastructure-networking' }, {}, { categorySlug: 'data-photos' }];

  assert.deepEqual(validateCategoryFreshness('data-photos', recentPosts), {
    valid: true,
    recentCategorySlugs: ['infrastructure-networking']
  });
});
