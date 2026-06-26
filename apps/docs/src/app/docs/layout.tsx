import { DocsLayout, type DocsLayoutProps } from 'fumadocs-ui/layouts/notebook';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { source } from '~/lib/fumadocs';
import { Providers } from '../providers';
import { ThemeToggle } from '../ThemeToggle';
import { baseOptions } from './layout.config';

const docsOptions: DocsLayoutProps = {
  ...baseOptions,
  tree: source.pageTree,
  sidebar: {
    defaultOpenLevel: 1
  },
  themeSwitch: {
    enabled: true,
    mode: 'light-dark-system'
  },
  slots: {
    ...baseOptions.slots,
    themeSwitch: ThemeToggle
  }
};

export const metadata: Metadata = {
  title: {
    template: '%s | Stackarr Docs',
    default: 'Stackarr Docs'
  },
  description: 'Stackarr alpha quick start, installation, and configuration documentation.'
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <Providers>
      <DocsLayout {...docsOptions}>{children}</DocsLayout>
    </Providers>
  );
}
