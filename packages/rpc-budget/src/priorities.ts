/**
 * Priority tiers for the shared RPC budget. Lower number drains first.
 *
 *   watcher  — must keep up with the chain head or it falls behind forever
 *   commit   — posting Merkle roots on a schedule
 *   outcomes — horizon resolution jobs (M4); tolerant of delay
 *   assess   — free on-demand reports; yields to scheduled watcher, commit and outcomes
 *   deepdive — LLM tool calls (M6); already rate-limited by its own budget
 *   backfill — the 14-day historical sweep (M4); lowest, yields to everything
 */
export const PRIORITY = {
  watcher: 0,
  commit: 1,
  outcomes: 2,
  assess: 3,
  deepdive: 4,
  backfill: 5,
} as const;

export type PriorityName = keyof typeof PRIORITY;
export type Priority = (typeof PRIORITY)[PriorityName];
