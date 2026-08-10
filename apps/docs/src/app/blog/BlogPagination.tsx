export function BlogPagination({
  currentPage,
  totalPages,
  basePath
}: {
  currentPage: number;
  totalPages: number;
  basePath: string;
}) {
  if (totalPages <= 1) return null;
  const pageHref = (page: number) => (page === 1 ? basePath : `${basePath}?page=${page}`);
  const start = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
  const pages = Array.from({ length: Math.min(5, totalPages) }, (_, index) => start + index);

  return (
    <nav className="blogPagination" aria-label="Blog pagination">
      {currentPage > 1 ? <a href={pageHref(currentPage - 1)}>← Newer</a> : <span />}
      <span className="blogPageNumbers">
        {pages.map((page) => (
          <a aria-current={page === currentPage ? 'page' : undefined} href={pageHref(page)} key={page}>
            {page.toString().padStart(2, '0')}
          </a>
        ))}
      </span>
      {currentPage < totalPages ? <a href={pageHref(currentPage + 1)}>Older →</a> : <span />}
    </nav>
  );
}
