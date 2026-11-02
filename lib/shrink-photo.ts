// Phones take photos of 3 to 12 MB, and job sites have weak signal. This makes one small enough to send quickly and still
// sharp enough to inspect. If the browser can't read the picture, the original goes up instead.
// It decodes through an <img>, which turns a phone photo the right way up in every current browser; createImageBitmap
// doesn't on every iPhone.
export async function shrinkPhoto(file: File, longestSide = 2400, quality = 0.85) {
  if (!file.type.startsWith("image/")) return file;
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, longestSide / Math.max(image.naturalWidth, image.naturalHeight));
    if (scale === 1 && file.type === "image/jpeg" && file.size < 1_500_000) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    // Free the canvas's memory now rather than whenever the browser gets to it; phones run out.
    canvas.width = 0;
    canvas.height = 0;
    if (!blob) return file;
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "photo"}.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}
