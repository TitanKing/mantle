'use client';

import Avatar from 'boring-avatars';
import { cn } from '@/lib/utils';
import { AVATAR_STYLE_IDS, DEFAULT_AVATAR_STYLE, type AvatarStyleId } from '@/lib/avatar';

/**
 * Renders a boring-avatars SVG for a {variant, seed}. boring-avatars is tiny,
 * so we render it directly client-side (no server endpoint needed). The
 * wrapper clips to a circle so square variants (pixel/bauhaus) match the rest.
 */

const VARIANTS = new Set<string>(AVATAR_STYLE_IDS);

/** Avatar colour palette — leads with the brand indigo, then a balanced
 *  spread so the geometric variants stay vivid but cohesive. */
const PALETTE = ['#6366f1', '#22d3ee', '#f59e0b', '#ec4899', '#10b981'];

export function BoringAvatar({
  variant,
  seed,
  size = 40,
  className,
  style,
}: {
  /** boring-avatars variant id (the stored avatar "style"). */
  variant: string;
  seed: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const v = (VARIANTS.has(variant) ? variant : DEFAULT_AVATAR_STYLE) as AvatarStyleId;
  return (
    <span
      className={cn('inline-flex shrink-0 overflow-hidden rounded-full', className)}
      style={style}
      aria-hidden
    >
      <Avatar name={seed || 'mantle'} variant={v} size={size} colors={PALETTE} />
    </span>
  );
}
