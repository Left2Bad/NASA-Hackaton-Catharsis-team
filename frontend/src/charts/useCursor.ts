import { useState, type KeyboardEvent } from 'react';

/**
 * The position a chart reads out: one of `count` points along its horizontal axis.
 * The pointer or the arrow keys pick a position; with nothing picked the chart shows
 * `fallback`. Shared by every chart, so they all answer to the same keys.
 */
export function useCursor(count: number, fallback: number) {
  const [picked, setPicked] = useState<number | null>(null);
  const last = Math.max(0, count - 1);
  const clamp = (index: number) => Math.max(0, Math.min(index, last));
  const active = clamp(picked ?? fallback);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const target = {
      ArrowLeft: active - 1,
      ArrowDown: active - 1,
      ArrowRight: active + 1,
      ArrowUp: active + 1,
      Home: 0,
      End: last,
    }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    setPicked(clamp(target));
  };

  return {
    /** Index of the position to read out. */
    active,
    /** True while the reader has picked a position; false when the chart shows its default. */
    isPicked: picked !== null,
    pick: (index: number) => setPicked(clamp(index)),
    reset: () => setPicked(null),
    onKeyDown,
  };
}
