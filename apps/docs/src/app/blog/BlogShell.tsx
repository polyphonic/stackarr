import type { BlogCategory } from '@stackarr/cms';
import { githubUrl } from '~/lib/site';
import { BlogMenu } from '../BlogMenu';
import { ThemeToggle } from '../ThemeToggle';

export function BlogShell({ categories, children }: { categories: BlogCategory[]; children: React.ReactNode }) {
  return (
    <div className="blogSite">
      <header className="blogNavWrap">
        <nav className="blogNav" aria-label="Blog navigation">
          <a className="blogBrand" href="/">
            <img alt="" src="/icon.svg" />
            <span>Stackarr</span>
          </a>
          <div className="blogNavLinks">
            <a href="/docs">Docs</a>
            <a href="/docs/installation">Install</a>
            <a href={githubUrl} rel="noreferrer" target="_blank">
              GitHub
            </a>
            <BlogMenu categories={categories} description="The latest Stackarr homelab field notes." />
            <ThemeToggle />
          </div>
        </nav>
      </header>
      {children}
      <footer className="blogFooter">
        <div>
          <a className="blogBrand" href="/">
            <img alt="" src="/icon.svg" />
            <span>Stackarr</span>
          </a>
          <p>Practical systems thinking for the self-hosted home.</p>
        </div>
        <div>
          <a href="/blog">Blog</a>
          <a href="/blog/feed.xml">RSS</a>
          <a href="/llms.txt">llms.txt</a>
          <a href="/docs">Docs</a>
        </div>
      </footer>
    </div>
  );
}
