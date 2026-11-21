"use client";
import { useEffect, useRef, useState } from "react";

/**
 * A row that slides sideways on a small screen (a loan's tabs): keeps the selected item in view, including when the
 * page opens on it from a link, and fades whichever edge has more beyond it so the row reads as one that scrolls.
 * The ref is a callback, so a row that first renders after its data loads is still picked up.
 */
export function useScrollRow<T extends HTMLElement>(selected: string) {
  const [row, setRow] = useState<T | null>(null);
  const [edges, setEdges] = useState({ before: false, after: false });
  const moved = useRef(false);
  useEffect(() => {
    if (!row) return;
    const check = () => setEdges({ before: row.scrollLeft > 4, after: row.scrollWidth - row.scrollLeft - row.clientWidth > 4 });
    check();
    const observer = new ResizeObserver(check);
    observer.observe(row);
    row.addEventListener("scroll", check, { passive: true });
    return () => { observer.disconnect(); row.removeEventListener("scroll", check); };
  }, [row]);
  useEffect(() => {
    const item = row?.querySelector<HTMLElement>("[aria-selected='true'], [aria-current='page']");
    if (!row || !item) return;
    if (row.scrollWidth > row.clientWidth) {
      // Sideways only: scrollIntoView would also move the page.
      const left = item.offsetLeft - row.offsetLeft - (row.clientWidth - item.offsetWidth) / 2;
      row.scrollTo({ left: Math.max(0, left), behavior: moved.current ? "smooth" : "instant" });
    }
    moved.current = true;
  }, [row, selected]);
  const fade = edges.before && edges.after
    ? "[mask-image:linear-gradient(to_right,transparent,black_28px,black_calc(100%-28px),transparent)]"
    : edges.after ? "[mask-image:linear-gradient(to_right,black_calc(100%-28px),transparent)]"
    : edges.before ? "[mask-image:linear-gradient(to_right,transparent,black_28px)]" : "";
  return { ref: setRow, fade, edges };
}
