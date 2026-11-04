"use client";
import { useRef, useState } from "react";
import { Section, shortDate } from "@/components/ui";
import type { Deal } from "@/lib/mockData";
import { shrinkPhoto } from "@/lib/shrink-photo";
import { useStore } from "@/lib/store";

const MAX = 12;

/**
 * Photos of the property on a loan: from the quote request, the application link, or added here by the borrower, their
 * broker or the team. The team can take one away.
 */
export function PropertyPhotos({ deal, side }: { deal: Deal; side: "team" | "client" }) {
  const { dispatch, uploadPropertyPhoto, local } = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [sending, setSending] = useState("");
  const photos = deal.propertyPhotos ?? [];
  const add = async (files: File[]) => {
    const chosen = files.filter((file) => file.type.startsWith("image/") || /\.(heic|heif)$/i.test(file.name)).slice(0, MAX - photos.length);
    for (const [index, original] of chosen.entries()) {
      setSending(`Sending ${index + 1} of ${chosen.length}…`);
      await uploadPropertyPhoto(deal.id, await shrinkPhoto(original));
    }
    setSending("");
  };
  return (
    <Section title={`Photos of the property (${photos.length})`}>
      <div data-testid="property-photos">
        {photos.length === 0 && <p className="text-sm text-muted-foreground">{side === "client" ? "Add photos of the front, the street and anything that needs work. They help us size the loan before the valuation." : "No photos yet. The borrower can add them from their loan page, or send them with the application link."}</p>}
        {photos.length > 0 && (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {photos.map((photo) => (
              <li key={photo.id} className="min-w-0" data-testid="property-photo">
                {local || photo.id.startsWith("demo-") ? <div className="grid aspect-square place-items-center rounded-[2px] bg-muted text-center text-[11px] text-muted-foreground">Sample photo</div> : (
                  <a href={`/api/documents/${photo.id}?view=1`} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element -- a signed-in file, not a page image */}
                    <img src={`/api/documents/${photo.id}?view=thumb`} alt={photo.name} loading="lazy" className="aspect-square w-full rounded-[2px] object-cover" />
                  </a>
                )}
                <p className="truncate text-[11px] text-muted-foreground" title={photo.name}>{shortDate(photo.at)}{photo.by ? ` · ${photo.by}` : ""}</p>
                {side === "team" && <button type="button" className="text-[11px] text-link underline" data-testid="remove-property-photo" onClick={() => void dispatch({ t: "removePropertyPhoto", dealId: deal.id, photoId: photo.id })}>Remove</button>}
              </li>
            ))}
          </ul>
        )}
        <input ref={input} type="file" accept="image/*,.heic,.heif" multiple className="hidden" data-testid="property-photo-input" onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void add(files); }} />
        {photos.length < MAX && <button type="button" className="btn-ghost mt-3 h-9! px-3! text-xs!" data-testid="add-property-photos" disabled={Boolean(sending)} onClick={() => input.current?.click()}>{sending || "Add photos"}</button>}
      </div>
    </Section>
  );
}
