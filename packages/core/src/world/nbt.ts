/**
 * Minimal reader for Minecraft's binary NBT format (big-endian, Java edition).
 *
 * Only what we need to pull a few scalar fields out of player data files.
 * The caller decompresses the gzip first (player .dat files are gzipped).
 * Runtime-agnostic (DataView), so it works in Node and Workers alike.
 *
 * Large arrays and lists are returned as summaries rather than materialised:
 * we never keep full player NBT (positions, inventories) around.
 */

export type NbtValue = number | bigint | string | NbtCompound | NbtList | NbtArraySummary;
export interface NbtCompound {
  [key: string]: NbtValue;
}
export interface NbtList {
  kind: "list";
  elementType: number;
  items: NbtValue[];
}
export interface NbtArraySummary {
  kind: "array";
  type: "byte" | "int" | "long";
  length: number;
}

const TAG = { END: 0, BYTE: 1, SHORT: 2, INT: 3, LONG: 4, FLOAT: 5, DOUBLE: 6, BYTE_ARRAY: 7, STRING: 8, LIST: 9, COMPOUND: 10, INT_ARRAY: 11, LONG_ARRAY: 12 } as const;

export class NbtError extends Error {}

export function readNbt(bytes: Uint8Array): NbtCompound {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder("utf-8");
  let o = 0;

  const need = (n: number) => {
    if (o + n > bytes.byteLength) throw new NbtError(`Unexpected end of NBT data at byte ${o}`);
  };
  const u8 = () => (need(1), view.getUint8(o++));
  const str = () => {
    need(2);
    const len = view.getUint16(o);
    o += 2;
    need(len);
    const s = decoder.decode(bytes.subarray(o, o + len));
    o += len;
    return s;
  };

  const payload = (type: number, depth: number): NbtValue => {
    if (depth > 64) throw new NbtError("NBT nesting too deep");
    switch (type) {
      case TAG.BYTE:
        need(1);
        return view.getInt8(o++);
      case TAG.SHORT: {
        need(2);
        const v = view.getInt16(o);
        o += 2;
        return v;
      }
      case TAG.INT: {
        need(4);
        const v = view.getInt32(o);
        o += 4;
        return v;
      }
      case TAG.LONG: {
        need(8);
        const v = view.getBigInt64(o);
        o += 8;
        return v;
      }
      case TAG.FLOAT: {
        need(4);
        const v = view.getFloat32(o);
        o += 4;
        return v;
      }
      case TAG.DOUBLE: {
        need(8);
        const v = view.getFloat64(o);
        o += 8;
        return v;
      }
      case TAG.STRING:
        return str();
      case TAG.BYTE_ARRAY:
      case TAG.INT_ARRAY:
      case TAG.LONG_ARRAY: {
        need(4);
        const len = view.getInt32(o);
        o += 4;
        const size = type === TAG.BYTE_ARRAY ? 1 : type === TAG.INT_ARRAY ? 4 : 8;
        need(len * size);
        o += len * size;
        return { kind: "array", type: type === TAG.BYTE_ARRAY ? "byte" : type === TAG.INT_ARRAY ? "int" : "long", length: len };
      }
      case TAG.LIST: {
        const elementType = u8();
        need(4);
        const len = view.getInt32(o);
        o += 4;
        const items: NbtValue[] = [];
        for (let i = 0; i < len; i++) items.push(payload(elementType, depth + 1));
        return { kind: "list", elementType, items };
      }
      case TAG.COMPOUND: {
        const out: NbtCompound = {};
        for (;;) {
          const t = u8();
          if (t === TAG.END) return out;
          const name = str();
          out[name] = payload(t, depth + 1);
        }
      }
      default:
        throw new NbtError(`Unknown NBT tag type ${type} at byte ${o - 1}`);
    }
  };

  const rootType = u8();
  if (rootType !== TAG.COMPOUND) throw new NbtError("NBT root must be a compound");
  str(); // root name (usually empty)
  return payload(TAG.COMPOUND, 0) as NbtCompound;
}

export function nbtNumber(v: NbtValue | undefined): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  return null;
}
