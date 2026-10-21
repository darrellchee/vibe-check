// Minimal schema-less protobuf wire reader. Antigravity's conversation store
// ships no .proto, so callers address fields by number. Values are zero-copy
// views over the input; nothing is decoded recursively unless asked.
export type Field = { n: number; wire: number; value: number | Uint8Array };

function varint(buf: Uint8Array, at: number): [number, number] | null {
  let result = 0,
    scale = 1;
  for (let i = at; i < buf.length && i < at + 10; i++) {
    // A 10th byte above 1 would overflow 64 bits: treat it as corrupt.
    if (i === at + 9 && buf[i] > 1) return null;
    result += (buf[i] & 0x7f) * scale;
    if ((buf[i] & 0x80) === 0) return [result, i + 1];
    scale *= 128;
  }
  return null;
}

/** Decode the top-level fields of one message; returns null if malformed. */
export function fields(buf: Uint8Array): Field[] | null {
  const out: Field[] = [];
  let at = 0;
  while (at < buf.length) {
    const key = varint(buf, at);
    if (!key) return null;
    at = key[1];
    const n = Math.floor(key[0] / 8),
      wire = key[0] % 8;
    if (n === 0) return null;
    if (wire === 0) {
      const v = varint(buf, at);
      if (!v) return null;
      out.push({ n, wire, value: v[0] });
      at = v[1];
    } else if (wire === 2) {
      const len = varint(buf, at);
      if (!len || len[1] + len[0] > buf.length) return null;
      out.push({ n, wire, value: buf.subarray(len[1], len[1] + len[0]) });
      at = len[1] + len[0];
    } else if (wire === 1 || wire === 5) {
      const size = wire === 1 ? 8 : 4;
      if (at + size > buf.length) return null;
      out.push({ n, wire, value: buf.subarray(at, at + size) });
      at += size;
    } else return null;
  }
  return out;
}

export const first = (list: Field[] | null, n: number) =>
  list?.find((f) => f.n === n);

/** Varint field value; a missing field means 0 (proto3 omits zero scalars). */
export const num = (list: Field[] | null, n: number): number => {
  const f = first(list, n);
  return f && f.wire === 0 ? (f.value as number) : 0;
};

/** Length-delimited field decoded as a nested message. */
export const message = (list: Field[] | null, n: number): Field[] | null => {
  const f = first(list, n);
  return f && f.wire === 2 ? fields(f.value as Uint8Array) : null;
};

export const string = (list: Field[] | null, n: number): string | undefined => {
  const f = first(list, n);
  return f && f.wire === 2
    ? new TextDecoder().decode(f.value as Uint8Array)
    : undefined;
};

/** Repeated varints, packed (wire 2) or unpacked (wire 0). */
export const repeated = (list: Field[] | null, n: number): number[] => {
  const out: number[] = [];
  for (const f of list || []) {
    if (f.n !== n) continue;
    if (f.wire === 0) out.push(f.value as number);
    else if (f.wire === 2) {
      const buf = f.value as Uint8Array;
      for (let at = 0; at < buf.length; ) {
        const v = varint(buf, at);
        if (!v) break;
        out.push(v[0]);
        at = v[1];
      }
    }
  }
  return out;
};

/** Seconds since epoch from a google.protobuf.Timestamp-shaped message. */
export const seconds = (list: Field[] | null): number | null => {
  const s = num(list, 1);
  return s > 0 ? s + num(list, 2) / 1e9 : null;
};
