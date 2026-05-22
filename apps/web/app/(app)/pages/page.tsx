import { requireOwner } from '@/lib/auth';
import { countPages, listPageTags, listPages } from '@/lib/pages';
import { SetPageTitle } from '@/components/layout/page-title';
import { PagesClient } from './pages-client';

const PAGE_SIZE = 50;

export default async function PagesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; tag?: string; q?: string }>;
}) {
  const user = await requireOwner();
  const sp = await searchParams;

  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);
  const query = sp.q?.trim() || undefined;
  const tag = sp.tag?.trim() || undefined;

  const [pages, total, tags] = await Promise.all([
    listPages(user.id, { query, tag, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    countPages(user.id, { query, tag }),
    listPageTags(user.id),
  ]);

  return (
    <>
      <SetPageTitle title="Pages" />
      <PagesClient
        pages={pages}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        tags={tags}
        activeTag={tag ?? null}
        query={query ?? ''}
      />
    </>
  );
}
