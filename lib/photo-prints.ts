// A photo's fingerprints, worked out in the browser as it's sent (lib/photo-checks.ts compares them): the SHA-256 of the
// file, which matches an exact copy, and a 64-bit difference hash of the picture, which still matches once it's been
// resized, re-saved or lightly cropped. The difference hash shrinks the picture to 9 by 8 grey pixels and records, for
// each row, whether each pixel is brighter than the next. The server keeps its own SHA-256 of what it stored and uses
// that one where it has it.
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");

async function differenceHash(file: Blob) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 9;
    canvas.height = 8;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return undefined;
    context.drawImage(image, 0, 0, 9, 8);
    const { data } = context.getImageData(0, 0, 9, 8);
    const grey = (x: number, y: number) => { const at = (y * 9 + x) * 4; return 0.299 * data[at] + 0.587 * data[at + 1] + 0.114 * data[at + 2]; };
    let bits = "";
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += grey(x, y) > grey(x + 1, y) ? "1" : "0";
    return Array.from({ length: 16 }, (_, index) => parseInt(bits.slice(index * 4, index * 4 + 4), 2).toString(16)).join("");
  } catch {
    return undefined;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Both fingerprints, or what could be worked out: an old browser or an unreadable file just has fewer. */
export async function photoPrints(file: Blob): Promise<{ sha256?: string; dhash?: string }> {
  const sha256 = await file.arrayBuffer().then((bytes) => crypto.subtle.digest("SHA-256", bytes)).then(hex, () => undefined);
  const dhash = await differenceHash(file);
  return { ...(sha256 ? { sha256 } : {}), ...(dhash ? { dhash } : {}) };
}
