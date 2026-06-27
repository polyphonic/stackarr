import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import { ServiceIntegration } from './components/ServiceIntegration';
import { ThemeCompare } from './components/ThemeCompare';

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    ServiceIntegration,
    ThemeCompare,
    ...components
  };
}
