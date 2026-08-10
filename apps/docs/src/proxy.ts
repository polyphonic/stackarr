import { isMarkdownPreferred, rewritePath } from 'fumadocs-core/negotiation';
import { type NextRequest, NextResponse } from 'next/server';

const BLOG_MARKDOWN_PATH_RE = /^\/blog(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?$/;
const { rewrite: rewriteDocsMarkdown } = rewritePath('/docs{/*path}', '/llms.mdx/docs{/*path}');

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (request.method !== 'GET' || !isMarkdownPreferred(request)) {
    return NextResponse.next();
  }

  if (pathname === '/' || BLOG_MARKDOWN_PATH_RE.test(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/markdown';
    url.searchParams.set('source', pathname);
    return NextResponse.rewrite(url);
  }

  const markdownPath = rewriteDocsMarkdown(pathname);
  if (markdownPath) {
    return NextResponse.rewrite(new URL(markdownPath, request.nextUrl));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/|logos/|icon.svg|icon-512.png|favicon.ico|manifest.webmanifest|sitemap.xml|robots.txt).*)']
};
