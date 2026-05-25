import { SUPPORTED_PROVIDERS, isProviderId, type ProviderId } from '@mantle/voice';
import { requireOwner } from '@/lib/auth';
import {
  fetchProviderModels,
  explorerCanFetch,
  queryModels,
  type ModelSort,
} from '@/lib/model-explorer';
import { SetPageTitle } from '@/components/layout/page-title';
import { ModelsClient } from './models-client';

const PAGE_SIZE = 50;
const SORTS: ModelSort[] = ['name', 'context', 'input', 'output', 'created'];

/**
 * Models — a live, provider-by-provider catalog explorer (Review group).
 * Everything is URL-driven SSR per the apps/web list convention: provider, q,
 * sort, kind, and page are read from searchParams; the provider's catalog is
 * fetched server-side (cached 5min) and filtered/sorted/paginated server-side.
 */
export default async function ModelsPage({
  searchParams,
}: {
  searchParams: Promise<{
    provider?: string;
    q?: string;
    sort?: string;
    kind?: string;
    page?: string;
  }>;
}) {
  const user = await requireOwner();
  const sp = await searchParams;

  const provider: ProviderId = isProviderId(sp.provider ?? '')
    ? (sp.provider as ProviderId)
    : 'openrouter';
  const q = sp.q?.trim() || undefined;
  const sort: ModelSort = SORTS.includes(sp.sort as ModelSort) ? (sp.sort as ModelSort) : 'name';
  const kind = sp.kind?.trim() || 'all';
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);

  const result = await fetchProviderModels(user.id, provider);
  const { rows, total, kinds } = queryModels(result.models, {
    q,
    kind,
    sort,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const providers = SUPPORTED_PROVIDERS.map((p) => ({
    id: p.id,
    label: p.label,
    description: p.description,
    signupUrl: p.signupUrl,
    docsUrl: p.docsUrl,
    isAggregator: p.isAggregator ?? false,
    canFetch: explorerCanFetch(p.id),
  }));

  return (
    <>
      <SetPageTitle title="Models" />
      <ModelsClient
        providers={providers}
        provider={provider}
        meta={{
          needsKey: result.needsKey ?? false,
          unsupported: result.unsupported ?? false,
          error: result.error ?? null,
          fetchedAt: result.fetchedAt,
        }}
        rows={rows}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        q={q ?? ''}
        sort={sort}
        kind={kind}
        kinds={kinds}
      />
    </>
  );
}
