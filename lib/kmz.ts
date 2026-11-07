// NHC publishes each storm's cone as a KMZ: a zip holding one KML file. This reads the first .kml out of one, with Node's
// own inflate, rather than adding a zip library for a single file. Server only.
import { inflateRawSync } from "node:zlib";

/** The text of the first .kml file in a zip, or null if there isn't one or the zip can't be read. */
export function firstKml(zip: Buffer): string | null {
  // The end of central directory record: its signature, somewhere in the last 64 KB (a comment can follow it).
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0 || end + 22 > zip.length) return null;
  const entries = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  for (let n = 0; n < entries; n++) {
    if (at + 46 > zip.length || zip.readUInt32LE(at) !== 0x02014b50) return null;
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extra = zip.readUInt16LE(at + 30);
    const comment = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    at += 46 + nameLength + extra + comment;
    if (!/\.kml$/i.test(name)) continue;
    if (local + 30 > zip.length || zip.readUInt32LE(local) !== 0x04034b50) return null;
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + size);
    try {
      if (method === 0) return data.toString("utf8");
      if (method === 8) return inflateRawSync(data).toString("utf8");
    } catch {
      return null;
    }
    return null;
  }
  return null;
}
