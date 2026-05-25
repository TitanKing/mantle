import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth';
import {
  refreshContextLimits,
  contextLimitMap,
  contextLimitsFetchedAt,
} from '@mantle/tracing';

/**
 * Live model → context-window-tokens map, sourced from OpenRouter's public
 * `/api/v1/models` catalog (cached + TTL-gated server-side, keyless) with a
 * static fallback. The agents form fetches this once to show the context
 * window for whatever model slug the operator types — the same source the
 * dashboard's context-% bars read from, so the number is consistent
 * everywhere.
 */
export async function GET() {
  await requireOwner();
  await refreshContextLimits();
  return NextResponse.json({
    limits: contextLimitMap(),
    fetchedAt: contextLimitsFetchedAt(),
  });
}
