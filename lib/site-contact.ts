import { getSettings } from "@/lib/settings";

/** LendHous's public contact details and NMLS ID, as an owner set them in Settings. Blank ones aren't shown. */
export type SiteContact = { phone: string; email: string; address: string; nmlsId: string };

export const NO_CONTACT: SiteContact = { phone: "", email: "", address: "", nmlsId: "" };

/**
 * The details the public site shows in its footer and on its Contact and Disclosures pages. A page never fails for want
 * of them: if the settings can't be read, it shows the contact forms only.
 */
export async function siteContact(): Promise<SiteContact> {
  try {
    const settings = await getSettings();
    return contactFrom(settings);
  } catch {
    return NO_CONTACT;
  }
}

export function contactFrom(settings: { lenderPhone?: string | null; contactEmail?: string | null; lenderAddress?: string | null; nmlsId?: string | null }): SiteContact {
  return {
    phone: (settings.lenderPhone ?? "").trim(),
    email: (settings.contactEmail ?? "").trim(),
    address: (settings.lenderAddress ?? "").trim(),
    nmlsId: (settings.nmlsId ?? "").replace(/\D/g, ""),
  };
}

/** A phone number as a tel: link: its digits, with a leading + kept. */
export const telHref = (phone: string) => `tel:${phone.trim().startsWith("+") ? "+" : ""}${phone.replace(/\D/g, "")}`;

/** NMLS Consumer Access, where anyone can look a licensee up by its ID. */
export const nmlsLookup = (id: string) => `https://www.nmlsconsumeraccess.org/EntityDetails.aspx/COMPANY/${encodeURIComponent(id)}`;
