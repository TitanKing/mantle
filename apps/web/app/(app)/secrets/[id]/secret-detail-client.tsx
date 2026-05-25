'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SetPageTitle } from '@/components/layout/page-title';
import { BackLink } from '@/components/layout/back-link';
import { SecretDetail, type SecretRow } from '../secret-detail';

/**
 * Deep-link wrapper for /secrets/[id]. The master-detail list (/secrets) is the
 * primary surface now, but this route stays working as a shareable deep link —
 * it reuses the same SecretDetail, adding page chrome (title + back link).
 */
export function SecretDetailClient({ initial }: { initial: SecretRow }) {
  const router = useRouter();
  const [title, setTitle] = useState(initial.title);
  return (
    <>
      <SetPageTitle title={title} />
      <div className="px-6 pt-2">
        <BackLink href="/secrets">All secrets</BackLink>
      </div>
      <SecretDetail
        secret={initial}
        onUpdated={(s) => setTitle(s.title)}
        onDeleted={() => router.push('/secrets')}
      />
    </>
  );
}
