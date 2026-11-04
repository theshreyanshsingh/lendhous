"use client";
import { useEffect, useRef, useState } from "react";
import { shrinkPhoto } from "@/lib/shrink-photo";

export const MAX_PICKED = 12;

type Picked = { key: string; name: string; src: string; file?: File; id?: string; state: "waiting" | "sending" | "sent" | "failed"; error?: string };

/**
 * Photos of the property, chosen on a phone or a computer. With upload, each one goes up as soon as it's picked (the
 * application link); without it, they're held until the form is sent (the quote request), and onChange hands them over.
 * Each is shrunk first, so a phone on weak signal sends it quickly.
 */
export function PropertyPhotoPicker({ upload, remove, initial = [], onChange, testid = "property-photos", note }: {
  upload?: (file: File) => Promise<{ id?: string; error?: string }>;
  remove?: (id: string) => Promise<boolean>;
  initial?: { id: string; name: string; src: string }[];
  onChange?: (files: File[]) => void;
  testid?: string; note?: string;
}) {
  const [items, setItems] = useState<Picked[]>(() => initial.map((photo) => ({ key: photo.id, name: photo.name, src: photo.src, id: photo.id, state: "sent" })));
  const input = useRef<HTMLInputElement>(null);
  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((url) => URL.revokeObjectURL(url)), []);
  useEffect(() => { onChange?.(items.filter((item) => item.file).map((item) => item.file!)); }, [items, onChange]);
  const patch = (key: string, change: Partial<Picked>) => setItems((current) => current.map((item) => (item.key === key ? { ...item, ...change } : item)));

  const add = async (files: File[]) => {
    const room = MAX_PICKED - items.length;
    const chosen = files.filter((file) => file.type.startsWith("image/") || /\.(heic|heif)$/i.test(file.name)).slice(0, Math.max(0, room));
    for (const original of chosen) {
      const file = await shrinkPhoto(original);
      const src = URL.createObjectURL(file);
      urls.current.push(src);
      const key = `${Date.now()}-${Math.random()}`;
      setItems((current) => [...current, { key, name: original.name, src, file: upload ? undefined : file, state: upload ? "sending" : "waiting" }]);
      if (!upload) continue;
      const reply: { id?: string; error?: string } = await upload(file).catch(() => ({ error: "That photo didn't go through." }));
      patch(key, reply.id ? { id: reply.id, state: "sent" } : { state: "failed", error: reply.error ?? "That photo didn't go through." });
    }
  };
  const drop = async (item: Picked) => {
    if (item.id && remove && !(await remove(item.id))) return;
    setItems((current) => current.filter((other) => other.key !== item.key));
  };

  return (
    <div data-testid={testid}>
      <input ref={input} type="file" accept="image/*,.heic,.heif" multiple className="hidden" style={{ display: "none" }} data-testid={`${testid}-input`} onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void add(files); }} />
      {items.length > 0 && (
        <ul style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 10, margin: "0 0 12px", padding: 0, listStyle: "none" }}>
          {items.map((item) => (
            <li key={item.key} data-testid={`${testid}-item`} style={{ position: "relative" }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- a local preview or a signed-in file, not a page image */}
              <img src={item.src} alt={item.name} style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", borderRadius: 2, opacity: item.state === "sending" ? 0.5 : 1 }} />
              <span style={{ display: "block", fontSize: 11, lineHeight: 1.3, marginTop: 2, color: item.state === "failed" ? "#9B2C2C" : "inherit" }}>{item.state === "sending" ? "Sending…" : item.state === "failed" ? item.error : item.state === "sent" ? "Sent" : "Ready to send"}</span>
              {item.state !== "sending" && <button type="button" aria-label={`Remove ${item.name}`} onClick={() => void drop(item)} style={{ position: "absolute", top: 4, right: 4, width: 26, height: 26, borderRadius: 13, border: "none", background: "rgba(0,0,0,0.6)", color: "#fff", cursor: "pointer", lineHeight: "26px" }}>×</button>}
            </li>
          ))}
        </ul>
      )}
      {items.length < MAX_PICKED && <button type="button" className="text-link" data-testid={`${testid}-add`} onClick={() => input.current?.click()}>+ Add photos of the property</button>}
      <small className="quote-hint" style={{ display: "block", marginTop: 6 }}>{note ?? `Optional, up to ${MAX_PICKED}: the front, the street, and the rooms or areas that need work.`}</small>
    </div>
  );
}
