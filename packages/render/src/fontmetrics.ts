// Vertical font metrics (ascent/descent as a share of the em) read from a font file: WOFF2, WOFF or TTF/OTF.
// Needed for Lottie, whose players place the first text baseline by "ascent" instead of CSS line boxes.
// Chrome uses hhea metrics, or the OS/2 typo metrics when the font sets USE_TYPO_METRICS.

import { brotliDecompressSync, inflateSync } from "node:zlib";

export interface FontMetrics { ascent: number; descent: number }

const KNOWN = ["cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill"];

export function fontMetrics(buf: Buffer): FontMetrics | null {
  try {
    const tables = readTables(buf);
    const head = tables.get("head");
    const hhea = tables.get("hhea");
    if (!head || !hhea) return null;
    const upm = head.readUInt16BE(18);
    let asc = hhea.readInt16BE(4);
    let desc = hhea.readInt16BE(6);
    const os2 = tables.get("OS/2");
    if (os2 && os2.length >= 74 && os2.readUInt16BE(62) & 0x80) {
      asc = os2.readInt16BE(68);
      desc = os2.readInt16BE(70);
    }
    return { ascent: asc / upm, descent: Math.abs(desc) / upm };
  } catch {
    return null;
  }
}

function readTables(buf: Buffer): Map<string, Buffer> {
  const sig = buf.toString("latin1", 0, 4);
  if (sig === "wOF2") return woff2(buf);
  if (sig === "wOFF") return woff(buf);
  return sfnt(buf);
}

function sfnt(buf: Buffer): Map<string, Buffer> {
  const n = buf.readUInt16BE(4);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < n; i++) {
    const r = 12 + i * 16;
    const off = buf.readUInt32BE(r + 8);
    out.set(buf.toString("latin1", r, r + 4), buf.subarray(off, off + buf.readUInt32BE(r + 12)));
  }
  return out;
}

function woff(buf: Buffer): Map<string, Buffer> {
  const n = buf.readUInt16BE(12);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < n; i++) {
    const r = 44 + i * 20;
    const off = buf.readUInt32BE(r + 4);
    const comp = buf.readUInt32BE(r + 8);
    const orig = buf.readUInt32BE(r + 12);
    const data = buf.subarray(off, off + comp);
    out.set(buf.toString("latin1", r, r + 4), comp < orig ? inflateSync(data) : data);
  }
  return out;
}

function woff2(buf: Buffer): Map<string, Buffer> {
  const n = buf.readUInt16BE(12);
  const compressed = buf.readUInt32BE(20);
  let p = 48;
  const base128 = () => {
    let v = 0;
    for (let i = 0; i < 5; i++) {
      const b = buf[p++];
      v = v * 128 + (b & 0x7f);
      if (!(b & 0x80)) return v;
    }
    throw new Error("bad UIntBase128");
  };
  const dir: { tag: string; len: number }[] = [];
  for (let i = 0; i < n; i++) {
    const flags = buf[p++];
    let tag: string;
    if ((flags & 0x3f) === 63) { tag = buf.toString("latin1", p, p + 4); p += 4; } else tag = KNOWN[flags & 0x3f];
    const version = flags >> 6;
    const orig = base128();
    const transformed = tag === "glyf" || tag === "loca" ? version === 0 : version !== 0;
    dir.push({ tag, len: transformed ? base128() : orig });
  }
  const data = brotliDecompressSync(buf.subarray(p, p + compressed));
  const out = new Map<string, Buffer>();
  let off = 0;
  for (const t of dir) { out.set(t.tag, data.subarray(off, off + t.len)); off += t.len; }
  return out;
}
