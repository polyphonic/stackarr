import type { BlogCategory } from '@stackarr/cms';
import { githubUrl } from '~/lib/site';
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
            <details className="blogCategoryMenu">
              <summary>Blog</summary>
              <div className="blogCategoryPanel">
                <a className="blogCategoryAll" href="/blog">
                  <strong>All articles</strong>
                  <span>The latest Stackarr homelab field notes.</span>
                </a>
                {categories.map((category) => (
                  <a href={`/blog/category/${category.slug}`} key={category._id}>
                    <strong>{category.title}</strong>
                    <span>{category.description}</span>
                  </a>
                ))}
              </div>
            </details>
            <a href="/docs">Docs</a>
            <a href="/docs/installation">Install</a>
            <a href={githubUrl} rel="noreferrer" target="_blank">
              GitHub
            </a>
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
