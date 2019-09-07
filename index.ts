type VarValue =
  | { string: Uint8Array }
  | { uint8: number }
  | { uint16: number }
  | { uint32: number }
  | { int8: number }
  | { int16: number }
  | { int32: number }
  | { varuint32: number }
  | { float: number }
  | { double: number };

function sizeVarUint32(num: number): number {
  return num < 0x80 ? 1 : num < 0x4000 ? 2 : num < 0x200000 ? 3 : num < 0x10000000 ? 4 : 5;
}

function writeVarUint32(num: number, view: DataView, pos: number): number {
  do {
    let temp = num & 0x7f;
    num >>= 7;
    if (num) temp |= 0x80;
    view.setUint8(pos++, temp);
  } while (num);
  return pos;
}

function writeString(str: Uint8Array, view: DataView, pos: number): number {
  pos = writeVarUint32(str.length, view, pos);
  for (let i = 0; i < str.length; i++) {
    view.setUint8(pos++, str[i]);
  }
  return pos;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function writeValue(value: VarValue, view: DataView, pos: number): number {
  if ("uint8" in value) {
    view.setUint8(pos, value.uint8);
    return pos + 1;
  } else if ("int8" in value) {
    view.setInt8(pos, value.int8);
    return pos + 1;
  } else if ("uint16" in value) {
    view.setUint16(pos, value.uint16, true);
    return pos + 2;
  } else if ("int16" in value) {
    view.setInt16(pos, value.int16, true);
    return pos + 2;
  } else if ("uint32" in value) {
    view.setUint32(pos, value.uint32, true);
    return pos + 4;
  } else if ("int32" in value) {
    view.setInt32(pos, value.int32, true);
    return pos + 4;
  } else if ("varuint32" in value) {
    return writeVarUint32(value.varuint32, view, pos);
  } else if ("string" in value) {
    return writeString(value.string, view, pos);
  } else if ("float" in value) {
    view.setFloat32(pos, value.float);
    return pos + 4;
  } else if ("double" in value) {
    view.setFloat64(pos, value.double);
    return pos + 8;
  }
}

export class Output {
  private cache: VarValue[];
  private length: number;
  constructor() {
    this.cache = [];
    this.length = 0;
  }

  pushUint8(value: number) {
    this.cache.push({ uint8: value });
    this.length += 1;
  }
  pushUint16(value: number) {
    this.cache.push({ uint16: value });
    this.length += 2;
  }
  pushUint32(value: number) {
    this.cache.push({ uint32: value });
    this.length += 4;
  }

  pushInt8(value: number) {
    this.cache.push({ int8: value });
    this.length += 1;
  }
  pushInt16(value: number) {
    this.cache.push({ int16: value });
    this.length += 2;
  }
  pushInt32(value: number) {
    this.cache.push({ int32: value });
    this.length += 4;
  }

  pushVarUInt32(value: number) {
    this.cache.push({ varuint32: value });
    this.length += sizeVarUint32(value);
  }

  pushVarInt32(value: number) {
    const fixed = value >= 0 ? value * 2 : ~(value * 2);
    this.cache.push({ varuint32: fixed });
    this.length += sizeVarUint32(fixed);
  }

  pushFloat(value: number) {
    this.cache.push({ float: value });
    this.length += 4;
  }

  pushDouble(value: number) {
    this.cache.push({ double: value });
    this.length += 8;
  }

  pushString(value: string) {
    const code = encoder.encode(value);
    this.cache.push({ string: code });
    this.length += sizeVarUint32(code.length) + code.length;
  }

  pushArray<T>(value: T[], feedback: (val: T, out: Output) => void) {
    this.pushVarUInt32(value.length);
    for (const item of value) {
      feedback(item, this);
    }
  }

  pushObject<T>(value: { [index: string]: T }, feedback: (key: string, val: T, out: Output) => void) {
    const ents = Object.entries(value);
    this.pushVarUInt32(ents.length);
    for (const [k, v] of ents) {
      this.pushString(k);
      feedback(k, v, this);
    }
  }

  write(): ArrayBuffer {
    const ret = new ArrayBuffer(this.length);
    const view = new DataView(ret);
    let pos = 0;
    for (const item of this.cache) {
      pos = writeValue(item, view, pos);
    }
    return ret;
  }
}

export class Input {
  private data: DataView;
  private pos: number = 0;
  constructor(data: DataView) {
    this.data = data;
  }

  private _read(): number {
    return this.data.getUint8(this.pos++);
  }

  readUint8(): number {
    return this.data.getUint8(this.pos++);
  }
  readUint16(): number {
    const ret = this.data.getUint16(this.pos);
    this.pos += 2;
    return ret;
  }
  readUint32(): number {
    const ret = this.data.getUint32(this.pos);
    this.pos += 4;
    return ret;
  }

  readInt8(): number {
    return this.data.getInt8(this.pos++);
  }
  readInt16(): number {
    const ret = this.data.getInt16(this.pos);
    this.pos += 2;
    return ret;
  }
  readInt32(): number {
    const ret = this.data.getInt32(this.pos);
    this.pos += 4;
    return ret;
  }

  readVarUint32(): number {
    let offset = 0;
    let temp = 0;
    let ret = 0;
    do {
      temp = this._read();
      ret |= (temp & 0x7f) << offset;
      offset += 7;
    } while (temp & 0x80);
    return ret;
  }

  readVarInt32(): number {
    const temp = this.readVarUint32();
    return temp & 1 ? ~(temp >> 1) : temp >> 1;
  }

  readFloat(): number {
    const ret = this.data.getFloat32(this.pos);
    this.pos += 4;
    return ret;
  }

  readDouble(): number {
    const ret = this.data.getFloat64(this.pos);
    this.pos += 8;
    return ret;
  }

  readString(): string {
    const len = this.readVarUint32();
    const ret = decoder.decode(new DataView(this.data.buffer, this.pos, len));
    this.pos += len;
    return ret;
  }

  iterateArray(feedback: (bi: Input, i: number) => void) {
    const len = this.readVarUint32();
    for (let i = 0; i < len; i++) {
      feedback(this, i);
    }
  }

  readArray<T>(cvt: (bi: Input, i: number) => T): T[] {
    const len = this.readVarUint32();
    const ret = [] as T[];
    for (let i = 0; i < len; i++) {
      ret.push(cvt(this, i));
    }
    return ret;
  }

  iterateObject(feedback: (key: string, bi: Input) => void) {
    const len = this.readVarUint32();
    for (let i = 0; i < len; i++) {
      const key = this.readString();
      feedback(key, this);
    }
  }

  readObject<T>(cvt: (key: string, bi: Input) => T): { [index: string]: T } {
    const len = this.readVarUint32();
    const ret = {} as { [index: string]: T };
    for (let i = 0; i < len; i++) {
      const key = this.readString();
      ret[key] = cvt(key, this);
    }
    return ret;
  }
}
