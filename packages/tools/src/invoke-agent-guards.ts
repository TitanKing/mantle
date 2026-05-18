/**
 * Pure guard checks for the `invoke_agent` builtin. Pulled into their
 * own module so vitest can lock down the safety properties without
 * touching the DB, the bridge, or `runToolLoop`.
 *
 * Three guarantees we MUST preserve:
 *   1. Bounded depth — no infinite agent recursion.
 *   2. Explicit allowlist — an agent can't delegate to an agent the
 *      operator didn't authorise.
 *   3. No self-call — an agent never invokes itself (zero-cost cycle).
 */

/** Maximum agent-chain length, inclusive of the entry-point agent.
 *  2 means "parent + child only". Bump deliberately if you ever want
 *  3-deep chains; every level above 2 is a stronger argument for a
 *  pipeline of pg_notify reactions instead of a delegation chain. */
export const MAX_AGENT_DEPTH = 2;

export type DepthCheckResult =
  | { ok: true; childDepth: number }
  | { ok: false; reason: string };

/**
 * Returns the depth the child WOULD run at, or refuses if it'd exceed
 * MAX_AGENT_DEPTH. Caller passes the parent's current depth; entry-
 * point agents are depth 1.
 */
export function checkAgentDepth(parentDepth: number): DepthCheckResult {
  if (!Number.isInteger(parentDepth) || parentDepth < 1) {
    return { ok: false, reason: `invalid parent depth ${parentDepth}` };
  }
  const childDepth = parentDepth + 1;
  if (childDepth > MAX_AGENT_DEPTH) {
    return {
      ok: false,
      reason:
        `agent delegation depth limit (${MAX_AGENT_DEPTH}) exceeded — ` +
        `a child agent cannot invoke another agent`,
    };
  }
  return { ok: true, childDepth };
}

export type AllowlistCheckResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Verify the parent agent is permitted to delegate to `targetSlug`.
 *
 * Permission lives on the parent agent's `memory_config.delegate_to`
 * — a list of agent slugs. Missing / empty list = no delegation
 * allowed (fail closed). Self-delegation is always refused even when
 * the slug is in the list.
 */
export function checkDelegationAllowed(
  parentAgentSlug: string,
  targetSlug: string,
  allowlist: readonly string[] | null | undefined,
): AllowlistCheckResult {
  if (!targetSlug || typeof targetSlug !== 'string') {
    return { ok: false, reason: 'agent_slug is required' };
  }
  if (targetSlug === parentAgentSlug) {
    return {
      ok: false,
      reason: `an agent cannot invoke itself ('${parentAgentSlug}')`,
    };
  }
  if (!Array.isArray(allowlist) || allowlist.length === 0) {
    return {
      ok: false,
      reason:
        `delegation not configured — add '${targetSlug}' to the parent agent's ` +
        `memory_config.delegate_to to enable`,
    };
  }
  if (!allowlist.includes(targetSlug)) {
    return {
      ok: false,
      reason:
        `target agent '${targetSlug}' is not in the parent's delegation allowlist`,
    };
  }
  return { ok: true };
}
