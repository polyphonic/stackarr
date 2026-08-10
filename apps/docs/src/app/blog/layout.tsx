import { getBlogCategories } from '@stackarr/cms';
import type { ReactNode } from 'react';
import { BlogShell } from './BlogShell';

export const revalidate = 3600;

export default async function BlogLayout({ children }: { children: ReactNode }) {
  const categories = await getBlogCategories();
  return <BlogShell categories={categories}>{children}</BlogShell>;
}
