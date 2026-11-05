// The "Recently funded" list for the public home page, read from the loan book at most every ten minutes. A borrower
// turning it on or off clears the copy (revalidateTag in actions/book.ts).
import { unstable_cache } from "next/cache";
import { readBook } from "./book-store";
import { showcaseOf } from "./showcase";

export const SHOWCASE_TAG = "showcase";

export const recentlyFunded = unstable_cache(async () => showcaseOf((await readBook()).book.deals), ["recently-funded"], { revalidate: 600, tags: [SHOWCASE_TAG] });
