"use client";

import { useSyncExternalStore } from "react";
import { toIso, utcLabel } from "../../lib/time";

/**
 * Timestamps are the classic hydration mismatch: the server formats in its own
 * locale and timezone, the browser formats in yours, and React reports that the
 * HTML differs. Render a stable, unambiguous string on the server and upgrade
 * to the reader's local format once mounted.
 */
const NO_SUBSCRIBE = () => () => {};

export function LocalTime({ value }: { value: string }) {
  const iso = toIso(value);
  // useSyncExternalStore is the sanctioned way to render differently on the
  // server and the client: React hydrates with the server snapshot, matching
  // the HTML exactly, then re-renders with the local one. No effect, no
  // mismatch, and no suppressHydrationWarning masking real problems.
  const label = useSyncExternalStore(
    NO_SUBSCRIBE,
    () => new Date(iso).toLocaleString(),
    () => utcLabel(iso),
  );

  return <time dateTime={iso}>{label}</time>;
}
