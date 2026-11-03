"use client";
import { useEffect, useState } from "react";
import { serviceDay } from "@/lib/book";
import { useStore } from "@/lib/store";

/** Today for servicing. Empty on the first render, because the server and the browser can disagree about the date. */
export function useServiceDay() {
  const { s } = useStore();
  const [day, setDay] = useState("");
  useEffect(() => { setDay(serviceDay(s)); }, [s]);
  return day;
}
