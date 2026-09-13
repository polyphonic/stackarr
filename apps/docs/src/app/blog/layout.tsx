import { getBlogCategories } from '@stackarr/cms';
import type { ReactNode } from 'react';
import { BlogShell } from './BlogShell';

export const dynamic = 'force-dynamic';

export default async function BlogLayout({ children }: { children: ReactNode }) {
  const categories = await getBlogCategories();
  return <BlogShell categories={categories}>{children}</BlogShell>;
}
