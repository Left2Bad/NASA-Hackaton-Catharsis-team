import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * The current width of an element in pixels, so a chart can be drawn at its real size
 * and keep its text at a readable size on a phone. Until the element is measured
 * (and in tests, where nothing is laid out) the width is `fallback`.
 */
export function useElementWidth<T extends HTMLElement>(
  fallback: number,
): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const measured = Math.round(entry.contentRect.width);
      // A hidden element reports zero: keep the last usable width instead.
      if (measured > 0) setWidth(measured);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}
