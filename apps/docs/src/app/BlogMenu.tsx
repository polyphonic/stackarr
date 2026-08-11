'use client';

import { Dropdown, icons } from '@stackarr/ui';

const ChevronDownIcon = icons.chevronDown;

type BlogMenuCategory = {
  slug: string;
  title: string;
  description: string;
};

export function BlogMenu({ categories, description }: { categories: BlogMenuCategory[]; description: string }) {
  return (
    <Dropdown>
      <Dropdown.Trigger className="blogCategoryTrigger">
        <span>Blog</span>
        <ChevronDownIcon className="blogCategoryChevron" size={15} />
      </Dropdown.Trigger>
      <Dropdown.Popover className="blogCategoryPopover" offset={10} placement="bottom end">
        <Dropdown.Menu aria-label="Blog categories" className="blogCategoryPanel">
          <Dropdown.Item
            className="blogCategoryItem blogCategoryAll"
            href="/blog"
            id="all-blog-articles"
            textValue="All articles"
          >
            <strong>All articles</strong>
            <span>{description}</span>
          </Dropdown.Item>
          {categories.map((category) => (
            <Dropdown.Item
              className="blogCategoryItem"
              href={`/blog/category/${category.slug}`}
              id={`blog-category-${category.slug}`}
              key={category.slug}
              textValue={category.title}
            >
              <strong>{category.title}</strong>
              <span>{category.description}</span>
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
