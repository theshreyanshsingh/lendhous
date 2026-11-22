"use client";
import { useEffect, useState } from "react";

/** The time now, once the page is in the browser (so the server's render and the browser's agree), kept fresh each minute. */
export function useNow(every = 60_000) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), every);
    return () => clearInterval(timer);
  }, [every]);
  return now;
}
