"use client";
import { useState } from "react";
import { HouseArt } from "@/components/art/HouseArt";
import type { Deal } from "@/lib/mockData";
import { useStore } from "@/lib/store";

const FRAME = { card: "aspect-[16/7] w-full sm:aspect-[3/1]", header: "aspect-[16/7] w-full sm:aspect-[16/10] sm:w-56 sm:shrink-0", thumb: "size-14 shrink-0" } as const;

/**
 * The picture a loan leads with: its first property photo; else, when the server has a Maps key, Street View of the
 * address; else the program's line drawing. A blind teaser only ever gets the drawing, since a picture would give the
 * property away.
 */
export function PropertyPicture({ deal, variant, blind = false }: { deal: Deal; variant: keyof typeof FRAME; blind?: boolean }) {
  const { local, streetView } = useStore();
  const [failed, setFailed] = useState(false);
  const photo = blind || local ? undefined : (deal.propertyPhotos ?? []).find((item) => !item.id.startsWith("demo-"));
  const src = failed ? "" : photo ? `/api/documents/${photo.id}?view=thumb` : !blind && streetView ? `/api/street-view/${deal.id}` : "";
  const frame = `${FRAME[variant]} overflow-hidden rounded-[2px] border border-border bg-muted/50`;
  if (!src) return <div className={`${frame} grid place-items-center`} data-testid="property-picture" data-kind="art"><HouseArt product={deal.app.product} className={variant === "thumb" ? "h-full w-full" : "h-full max-h-40 w-full"} /></div>;
  return (
    <div className={frame} data-testid="property-picture" data-kind={photo ? "photo" : "street-view"}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a signed-in file or a relayed Street View picture, not a page image */}
      <img src={src} alt={photo ? `Photo of ${deal.address}` : `Street View of ${deal.address}`} loading="lazy" className="h-full w-full object-cover" onError={() => setFailed(true)} />
    </div>
  );
}
