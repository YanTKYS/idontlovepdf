var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};

// (disabled):fs
var require_fs = __commonJS({
  "(disabled):fs"() {
  }
});

// src/syntax.js
var WHITESPACE = /* @__PURE__ */ new Set([0, 9, 10, 12, 13, 32]);
var DELIMITERS = new Set([..."()<>[]{}/%"].map((character) => character.charCodeAt(0)));
function isWhite(byte) {
  return WHITESPACE.has(byte);
}
function isDelimiter(byte) {
  return DELIMITERS.has(byte);
}
function isRegular(byte) {
  return byte !== void 0 && !isWhite(byte) && !isDelimiter(byte);
}
function skipWhite(bytes, start) {
  let cursor = start;
  while (cursor < bytes.length) {
    if (isWhite(bytes[cursor])) cursor += 1;
    else if (bytes[cursor] === 37) {
      while (cursor < bytes.length && bytes[cursor] !== 10 && bytes[cursor] !== 13) cursor += 1;
    } else break;
  }
  return cursor;
}

// src/content-stream.js
var latin1 = new TextDecoder("latin1");
function readLiteral(bytes, start) {
  let depth = 1;
  let cursor = start + 1;
  const value = [];
  while (cursor < bytes.length && depth > 0) {
    const byte = bytes[cursor++];
    if (byte === 92) {
      if (cursor >= bytes.length) break;
      const escaped = bytes[cursor++];
      const simple = { 110: 10, 114: 13, 116: 9, 98: 8, 102: 12 };
      if (simple[escaped] !== void 0) value.push(simple[escaped]);
      else if (escaped === 10) continue;
      else if (escaped === 13) {
        if (bytes[cursor] === 10) cursor += 1;
      } else if (escaped >= 48 && escaped <= 55) {
        let octal = escaped - 48;
        for (let count = 1; count < 3 && bytes[cursor] >= 48 && bytes[cursor] <= 55; count += 1) {
          octal = octal * 8 + bytes[cursor++] - 48;
        }
        value.push(octal & 255);
      } else value.push(escaped);
    } else if (byte === 40) {
      depth += 1;
      value.push(byte);
    } else if (byte === 41) {
      depth -= 1;
      if (depth > 0) value.push(byte);
    } else value.push(byte);
  }
  if (depth !== 0) throw new Error("Malformed PDF literal string");
  return { end: cursor, value: Uint8Array.from(value), syntax: "literal" };
}
function readHex(bytes, start) {
  let cursor = start + 1;
  let digits = "";
  while (cursor < bytes.length && bytes[cursor] !== 62) {
    if (!isWhite(bytes[cursor])) digits += String.fromCharCode(bytes[cursor]);
    cursor += 1;
  }
  if (cursor === bytes.length || !/^[0-9a-f]*$/i.test(digits)) throw new Error("Malformed PDF hex string");
  if (digits.length % 2) digits += "0";
  return {
    end: cursor + 1,
    value: Uint8Array.from(digits.match(/../g)?.map((pair) => Number.parseInt(pair, 16)) ?? []),
    syntax: "hex"
  };
}
function skipArray(bytes, start) {
  let cursor = start + 1;
  let depth = 1;
  while (cursor < bytes.length && depth > 0) {
    cursor = skipWhite(bytes, cursor);
    if (cursor >= bytes.length) break;
    if (bytes[cursor] === 91) {
      depth += 1;
      cursor += 1;
    } else if (bytes[cursor] === 93) {
      depth -= 1;
      cursor += 1;
    } else if (bytes[cursor] === 40) {
      cursor = readLiteral(bytes, cursor).end;
    } else if (bytes[cursor] === 60 && bytes[cursor + 1] === 60) {
      cursor = skipDictionary(bytes, cursor);
    } else if (bytes[cursor] === 60) {
      cursor = readHex(bytes, cursor).end;
    } else {
      cursor += 1;
    }
  }
  if (depth !== 0) throw new Error("Malformed PDF array in content stream");
  return cursor;
}
function skipDictionary(bytes, start) {
  if (bytes[start] !== 60 || bytes[start + 1] !== 60) throw new Error("Expected a PDF dictionary");
  let cursor = start + 2;
  let depth = 1;
  while (cursor < bytes.length && depth > 0) {
    cursor = skipWhite(bytes, cursor);
    if (cursor >= bytes.length) break;
    if (bytes[cursor] === 60 && bytes[cursor + 1] === 60) {
      depth += 1;
      cursor += 2;
    } else if (bytes[cursor] === 62 && bytes[cursor + 1] === 62) {
      depth -= 1;
      cursor += 2;
    } else if (bytes[cursor] === 40) {
      cursor = readLiteral(bytes, cursor).end;
    } else if (bytes[cursor] === 60) {
      cursor = readHex(bytes, cursor).end;
    } else if (bytes[cursor] === 91) {
      cursor = skipArray(bytes, cursor);
    } else {
      cursor += 1;
    }
  }
  if (depth !== 0) throw new Error("Malformed PDF dictionary in content stream");
  return cursor;
}
function encodeLiteral(value) {
  const output = [40];
  for (const byte of value) {
    if (byte === 40 || byte === 41 || byte === 92) output.push(92, byte);
    else if (byte === 10) output.push(92, 110);
    else if (byte === 13) output.push(92, 114);
    else output.push(byte);
  }
  output.push(41);
  return Uint8Array.from(output);
}
function encodeHex(value) {
  return new TextEncoder().encode(`<${[...value].map((byte) => byte.toString(16).padStart(2, "0")).join("")}>`);
}
function skipInlineImage(bytes, start) {
  let cursor = start;
  while (cursor < bytes.length) {
    const isIdOperator = bytes[cursor] === 73 && bytes[cursor + 1] === 68 && !isRegular(bytes[cursor - 1]) && !isRegular(bytes[cursor + 2]);
    if (isIdOperator) break;
    cursor += 1;
  }
  if (cursor >= bytes.length) return bytes.length;
  cursor += 2;
  if (isWhite(bytes[cursor])) cursor += 1;
  while (cursor < bytes.length) {
    const isEiOperator = bytes[cursor] === 69 && bytes[cursor + 1] === 73 && isWhite(bytes[cursor - 1]) && !isRegular(bytes[cursor + 2]);
    if (isEiOperator) return cursor + 2;
    cursor += 1;
  }
  return bytes.length;
}
function withStreamContext(read, bytes, cursor, context) {
  try {
    return read();
  } catch (error) {
    const suffix = context ? `${context}, byte offset ${cursor}` : `byte offset ${cursor}`;
    const wrapped = new Error(`${error.message} (${suffix})`);
    wrapped.contentStreamOffset = cursor;
    wrapped.contentStreamExcerpt = latin1.decode(bytes.subarray(Math.max(0, cursor - 20), Math.min(bytes.length, cursor + 20)));
    throw wrapped;
  }
}
var CONTINUITY_SAFE_OPERATORS = /* @__PURE__ */ new Set([
  "Tc",
  "Tw",
  "Tz",
  "Tr",
  "TL",
  "g",
  "rg",
  "k",
  "cs",
  "sc",
  "scn",
  "G",
  "RG",
  "K",
  "CS",
  "SC",
  "SCN",
  "BMC",
  "BDC",
  "EMC",
  "MP",
  "DP"
]);
var NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;
function joinAcrossOperators(runs, continuityId, boundaryClean, displacement) {
  const previous = runs.at(-1);
  if (!previous || previous.continuityId !== continuityId) return null;
  return boundaryClean ? { kind: "adjacent-operator", adjustment: displacement } : { kind: "state-change" };
}
function scanTextRuns(bytes, context = "") {
  const strings = [];
  const runs = [];
  let cursor = 0;
  let inText = false;
  let currentFont = null;
  let currentFontSize = null;
  let lastName = null;
  let lastNumber = null;
  let wordSpacing = 0;
  const graphicsStack = [];
  let textObjectId = -1;
  let continuityId = 0;
  let boundaryClean = false;
  let pendingRuns = [];
  const resolveFollowedBy = (value) => {
    for (const index of pendingRuns) runs[index].followedBy = value;
    pendingRuns = [];
  };
  let displacement = 0;
  while (cursor < bytes.length) {
    cursor = skipWhite(bytes, cursor);
    if (cursor >= bytes.length) break;
    if (bytes[cursor] === 40) {
      const token = withStreamContext(() => readLiteral(bytes, cursor), bytes, cursor, context);
      strings.push({ ...token, start: cursor, displacement });
      displacement = 0;
      cursor = token.end;
      continue;
    }
    if (bytes[cursor] === 60 && bytes[cursor + 1] === 60) {
      cursor = withStreamContext(() => skipDictionary(bytes, cursor), bytes, cursor, context);
      continue;
    }
    if (bytes[cursor] === 60) {
      const token = withStreamContext(() => readHex(bytes, cursor), bytes, cursor, context);
      strings.push({ ...token, start: cursor, displacement });
      displacement = 0;
      cursor = token.end;
      continue;
    }
    if (bytes[cursor] === 47) {
      const start2 = ++cursor;
      while (isRegular(bytes[cursor])) cursor += 1;
      lastName = latin1.decode(bytes.subarray(start2, cursor));
      continue;
    }
    const start = cursor;
    while (isRegular(bytes[cursor])) cursor += 1;
    if (cursor === start) {
      cursor += 1;
      continue;
    }
    const operator = latin1.decode(bytes.subarray(start, cursor));
    if (NUMBER.test(operator)) {
      displacement += Number(operator);
      lastNumber = Number(operator);
      continue;
    }
    if (operator === "BI") {
      cursor = skipInlineImage(bytes, cursor);
      strings.length = 0;
      lastName = null;
      displacement = 0;
      continuityId += 1;
      boundaryClean = false;
    } else if (operator === "BT") {
      resolveFollowedBy("end-of-text-object");
      inText = true;
      currentFont = null;
      currentFontSize = null;
      textObjectId += 1;
      strings.length = 0;
      displacement = 0;
      continuityId += 1;
      boundaryClean = false;
    } else if (operator === "ET") {
      resolveFollowedBy("end-of-text-object");
      inText = false;
      strings.length = 0;
      displacement = 0;
      continuityId += 1;
      boundaryClean = false;
    } else if (inText && operator === "Tf") {
      if (lastName !== currentFont) continuityId += 1;
      currentFont = lastName;
      currentFontSize = lastNumber;
      strings.length = 0;
      displacement = 0;
      lastNumber = null;
      boundaryClean = false;
    } else if (inText && (operator === "Tj" || operator === "'" || operator === '"' || operator === "TJ")) {
      resolveFollowedBy(operator === "'" || operator === '"' ? "repositioned" : "text-continues");
      if (operator === '"') wordSpacing = null;
      if (operator === "'" || operator === '"') continuityId += 1;
      strings.forEach((string, index) => {
        const joinBefore = index === 0 ? joinAcrossOperators(runs, continuityId, boundaryClean, string.displacement) : { kind: "tj-array", adjustment: string.displacement };
        runs.push({
          ...string,
          fontName: currentFont,
          // The size the enclosing `Tf` set, so a caller that has to re-state the font
          // can re-state it at the size the PDF was already drawing at. null when no
          // `Tf` has run in this text object.
          fontSize: currentFontSize,
          // The word spacing in force where this run is drawn; null when unknown.
          wordSpacing,
          operator,
          // Byte offset just past the text-showing operator that drew this run, so the
          // whole `<operand> Tj` can be rewritten as a unit rather than the operand alone.
          operatorEnd: cursor,
          textObjectId,
          continuityId,
          joinBefore,
          // Only the operator's last operand is still open: an earlier one is immediately
          // followed by the next operand of the same operator, drawn where it ended.
          followedBy: index === strings.length - 1 ? null : "text-continues"
        });
        if (index === strings.length - 1) pendingRuns.push(runs.length - 1);
      });
      strings.length = 0;
      lastNumber = null;
      boundaryClean = true;
    } else {
      if (operator === "Tw") wordSpacing = lastNumber;
      else if (operator === "q") graphicsStack.push(wordSpacing);
      else if (operator === "Q") wordSpacing = graphicsStack.length ? graphicsStack.pop() : null;
      strings.length = 0;
      lastName = null;
      lastNumber = null;
      if (operator === "Td" || operator === "TD" || operator === "Tm" || operator === "T*") {
        resolveFollowedBy("repositioned");
      }
      displacement = 0;
      if (!CONTINUITY_SAFE_OPERATORS.has(operator)) continuityId += 1;
      boundaryClean = false;
    }
  }
  resolveFollowedBy("end-of-content-stream");
  return runs;
}
function replaceTextRuns(bytes, replacements) {
  const runs = scanTextRuns(bytes);
  const byIndex = new Map(replacements.map((replacement) => [replacement.runIndex, replacement.bytes]));
  const chunks = [];
  let cursor = 0;
  runs.forEach((run, index) => {
    if (!byIndex.has(index)) return;
    chunks.push(bytes.subarray(cursor, run.start));
    chunks.push(run.syntax === "hex" ? encodeHex(byIndex.get(index)) : encodeLiteral(byIndex.get(index)));
    cursor = run.end;
  });
  chunks.push(bytes.subarray(cursor));
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

// node_modules/opentype.js/dist/opentype.module.js
if (!String.prototype.codePointAt) {
  (function() {
    var defineProperty = (function() {
      try {
        var object = {};
        var $defineProperty = Object.defineProperty;
        var result = $defineProperty(object, object, object) && $defineProperty;
      } catch (error) {
      }
      return result;
    })();
    var codePointAt = function(position) {
      if (this == null) {
        throw TypeError();
      }
      var string = String(this);
      var size = string.length;
      var index = position ? Number(position) : 0;
      if (index != index) {
        index = 0;
      }
      if (index < 0 || index >= size) {
        return void 0;
      }
      var first = string.charCodeAt(index);
      var second;
      if (
        // check if it’s the start of a surrogate pair
        first >= 55296 && first <= 56319 && // high surrogate
        size > index + 1
      ) {
        second = string.charCodeAt(index + 1);
        if (second >= 56320 && second <= 57343) {
          return (first - 55296) * 1024 + second - 56320 + 65536;
        }
      }
      return first;
    };
    if (defineProperty) {
      defineProperty(String.prototype, "codePointAt", {
        "value": codePointAt,
        "configurable": true,
        "writable": true
      });
    } else {
      String.prototype.codePointAt = codePointAt;
    }
  })();
}
var TINF_OK = 0;
var TINF_DATA_ERROR = -3;
function Tree() {
  this.table = new Uint16Array(16);
  this.trans = new Uint16Array(288);
}
function Data(source, dest) {
  this.source = source;
  this.sourceIndex = 0;
  this.tag = 0;
  this.bitcount = 0;
  this.dest = dest;
  this.destLen = 0;
  this.ltree = new Tree();
  this.dtree = new Tree();
}
var sltree = new Tree();
var sdtree = new Tree();
var length_bits = new Uint8Array(30);
var length_base = new Uint16Array(30);
var dist_bits = new Uint8Array(30);
var dist_base = new Uint16Array(30);
var clcidx = new Uint8Array([
  16,
  17,
  18,
  0,
  8,
  7,
  9,
  6,
  10,
  5,
  11,
  4,
  12,
  3,
  13,
  2,
  14,
  1,
  15
]);
var code_tree = new Tree();
var lengths = new Uint8Array(288 + 32);
function tinf_build_bits_base(bits, base, delta, first) {
  var i, sum;
  for (i = 0; i < delta; ++i) {
    bits[i] = 0;
  }
  for (i = 0; i < 30 - delta; ++i) {
    bits[i + delta] = i / delta | 0;
  }
  for (sum = first, i = 0; i < 30; ++i) {
    base[i] = sum;
    sum += 1 << bits[i];
  }
}
function tinf_build_fixed_trees(lt, dt) {
  var i;
  for (i = 0; i < 7; ++i) {
    lt.table[i] = 0;
  }
  lt.table[7] = 24;
  lt.table[8] = 152;
  lt.table[9] = 112;
  for (i = 0; i < 24; ++i) {
    lt.trans[i] = 256 + i;
  }
  for (i = 0; i < 144; ++i) {
    lt.trans[24 + i] = i;
  }
  for (i = 0; i < 8; ++i) {
    lt.trans[24 + 144 + i] = 280 + i;
  }
  for (i = 0; i < 112; ++i) {
    lt.trans[24 + 144 + 8 + i] = 144 + i;
  }
  for (i = 0; i < 5; ++i) {
    dt.table[i] = 0;
  }
  dt.table[5] = 32;
  for (i = 0; i < 32; ++i) {
    dt.trans[i] = i;
  }
}
var offs = new Uint16Array(16);
function tinf_build_tree(t, lengths2, off, num) {
  var i, sum;
  for (i = 0; i < 16; ++i) {
    t.table[i] = 0;
  }
  for (i = 0; i < num; ++i) {
    t.table[lengths2[off + i]]++;
  }
  t.table[0] = 0;
  for (sum = 0, i = 0; i < 16; ++i) {
    offs[i] = sum;
    sum += t.table[i];
  }
  for (i = 0; i < num; ++i) {
    if (lengths2[off + i]) {
      t.trans[offs[lengths2[off + i]]++] = i;
    }
  }
}
function tinf_getbit(d) {
  if (!d.bitcount--) {
    d.tag = d.source[d.sourceIndex++];
    d.bitcount = 7;
  }
  var bit = d.tag & 1;
  d.tag >>>= 1;
  return bit;
}
function tinf_read_bits(d, num, base) {
  if (!num) {
    return base;
  }
  while (d.bitcount < 24) {
    d.tag |= d.source[d.sourceIndex++] << d.bitcount;
    d.bitcount += 8;
  }
  var val = d.tag & 65535 >>> 16 - num;
  d.tag >>>= num;
  d.bitcount -= num;
  return val + base;
}
function tinf_decode_symbol(d, t) {
  while (d.bitcount < 24) {
    d.tag |= d.source[d.sourceIndex++] << d.bitcount;
    d.bitcount += 8;
  }
  var sum = 0, cur = 0, len = 0;
  var tag = d.tag;
  do {
    cur = 2 * cur + (tag & 1);
    tag >>>= 1;
    ++len;
    sum += t.table[len];
    cur -= t.table[len];
  } while (cur >= 0);
  d.tag = tag;
  d.bitcount -= len;
  return t.trans[sum + cur];
}
function tinf_decode_trees(d, lt, dt) {
  var hlit, hdist, hclen;
  var i, num, length;
  hlit = tinf_read_bits(d, 5, 257);
  hdist = tinf_read_bits(d, 5, 1);
  hclen = tinf_read_bits(d, 4, 4);
  for (i = 0; i < 19; ++i) {
    lengths[i] = 0;
  }
  for (i = 0; i < hclen; ++i) {
    var clen = tinf_read_bits(d, 3, 0);
    lengths[clcidx[i]] = clen;
  }
  tinf_build_tree(code_tree, lengths, 0, 19);
  for (num = 0; num < hlit + hdist; ) {
    var sym = tinf_decode_symbol(d, code_tree);
    switch (sym) {
      case 16:
        var prev = lengths[num - 1];
        for (length = tinf_read_bits(d, 2, 3); length; --length) {
          lengths[num++] = prev;
        }
        break;
      case 17:
        for (length = tinf_read_bits(d, 3, 3); length; --length) {
          lengths[num++] = 0;
        }
        break;
      case 18:
        for (length = tinf_read_bits(d, 7, 11); length; --length) {
          lengths[num++] = 0;
        }
        break;
      default:
        lengths[num++] = sym;
        break;
    }
  }
  tinf_build_tree(lt, lengths, 0, hlit);
  tinf_build_tree(dt, lengths, hlit, hdist);
}
function tinf_inflate_block_data(d, lt, dt) {
  while (1) {
    var sym = tinf_decode_symbol(d, lt);
    if (sym === 256) {
      return TINF_OK;
    }
    if (sym < 256) {
      d.dest[d.destLen++] = sym;
    } else {
      var length, dist, offs2;
      var i;
      sym -= 257;
      length = tinf_read_bits(d, length_bits[sym], length_base[sym]);
      dist = tinf_decode_symbol(d, dt);
      offs2 = d.destLen - tinf_read_bits(d, dist_bits[dist], dist_base[dist]);
      for (i = offs2; i < offs2 + length; ++i) {
        d.dest[d.destLen++] = d.dest[i];
      }
    }
  }
}
function tinf_inflate_uncompressed_block(d) {
  var length, invlength;
  var i;
  while (d.bitcount > 8) {
    d.sourceIndex--;
    d.bitcount -= 8;
  }
  length = d.source[d.sourceIndex + 1];
  length = 256 * length + d.source[d.sourceIndex];
  invlength = d.source[d.sourceIndex + 3];
  invlength = 256 * invlength + d.source[d.sourceIndex + 2];
  if (length !== (~invlength & 65535)) {
    return TINF_DATA_ERROR;
  }
  d.sourceIndex += 4;
  for (i = length; i; --i) {
    d.dest[d.destLen++] = d.source[d.sourceIndex++];
  }
  d.bitcount = 0;
  return TINF_OK;
}
function tinf_uncompress(source, dest) {
  var d = new Data(source, dest);
  var bfinal, btype, res;
  do {
    bfinal = tinf_getbit(d);
    btype = tinf_read_bits(d, 2, 0);
    switch (btype) {
      case 0:
        res = tinf_inflate_uncompressed_block(d);
        break;
      case 1:
        res = tinf_inflate_block_data(d, sltree, sdtree);
        break;
      case 2:
        tinf_decode_trees(d, d.ltree, d.dtree);
        res = tinf_inflate_block_data(d, d.ltree, d.dtree);
        break;
      default:
        res = TINF_DATA_ERROR;
    }
    if (res !== TINF_OK) {
      throw new Error("Data error");
    }
  } while (!bfinal);
  if (d.destLen < d.dest.length) {
    if (typeof d.dest.slice === "function") {
      return d.dest.slice(0, d.destLen);
    } else {
      return d.dest.subarray(0, d.destLen);
    }
  }
  return d.dest;
}
tinf_build_fixed_trees(sltree, sdtree);
tinf_build_bits_base(length_bits, length_base, 4, 3);
tinf_build_bits_base(dist_bits, dist_base, 2, 1);
length_bits[28] = 0;
length_base[28] = 258;
var tinyInflate = tinf_uncompress;
function derive(v0, v1, v2, v3, t) {
  return Math.pow(1 - t, 3) * v0 + 3 * Math.pow(1 - t, 2) * t * v1 + 3 * (1 - t) * Math.pow(t, 2) * v2 + Math.pow(t, 3) * v3;
}
function BoundingBox() {
  this.x1 = Number.NaN;
  this.y1 = Number.NaN;
  this.x2 = Number.NaN;
  this.y2 = Number.NaN;
}
BoundingBox.prototype.isEmpty = function() {
  return isNaN(this.x1) || isNaN(this.y1) || isNaN(this.x2) || isNaN(this.y2);
};
BoundingBox.prototype.addPoint = function(x, y) {
  if (typeof x === "number") {
    if (isNaN(this.x1) || isNaN(this.x2)) {
      this.x1 = x;
      this.x2 = x;
    }
    if (x < this.x1) {
      this.x1 = x;
    }
    if (x > this.x2) {
      this.x2 = x;
    }
  }
  if (typeof y === "number") {
    if (isNaN(this.y1) || isNaN(this.y2)) {
      this.y1 = y;
      this.y2 = y;
    }
    if (y < this.y1) {
      this.y1 = y;
    }
    if (y > this.y2) {
      this.y2 = y;
    }
  }
};
BoundingBox.prototype.addX = function(x) {
  this.addPoint(x, null);
};
BoundingBox.prototype.addY = function(y) {
  this.addPoint(null, y);
};
BoundingBox.prototype.addBezier = function(x0, y0, x1, y1, x2, y2, x, y) {
  var p0 = [x0, y0];
  var p1 = [x1, y1];
  var p2 = [x2, y2];
  var p3 = [x, y];
  this.addPoint(x0, y0);
  this.addPoint(x, y);
  for (var i = 0; i <= 1; i++) {
    var b = 6 * p0[i] - 12 * p1[i] + 6 * p2[i];
    var a = -3 * p0[i] + 9 * p1[i] - 9 * p2[i] + 3 * p3[i];
    var c = 3 * p1[i] - 3 * p0[i];
    if (a === 0) {
      if (b === 0) {
        continue;
      }
      var t = -c / b;
      if (0 < t && t < 1) {
        if (i === 0) {
          this.addX(derive(p0[i], p1[i], p2[i], p3[i], t));
        }
        if (i === 1) {
          this.addY(derive(p0[i], p1[i], p2[i], p3[i], t));
        }
      }
      continue;
    }
    var b2ac = Math.pow(b, 2) - 4 * c * a;
    if (b2ac < 0) {
      continue;
    }
    var t1 = (-b + Math.sqrt(b2ac)) / (2 * a);
    if (0 < t1 && t1 < 1) {
      if (i === 0) {
        this.addX(derive(p0[i], p1[i], p2[i], p3[i], t1));
      }
      if (i === 1) {
        this.addY(derive(p0[i], p1[i], p2[i], p3[i], t1));
      }
    }
    var t2 = (-b - Math.sqrt(b2ac)) / (2 * a);
    if (0 < t2 && t2 < 1) {
      if (i === 0) {
        this.addX(derive(p0[i], p1[i], p2[i], p3[i], t2));
      }
      if (i === 1) {
        this.addY(derive(p0[i], p1[i], p2[i], p3[i], t2));
      }
    }
  }
};
BoundingBox.prototype.addQuad = function(x0, y0, x1, y1, x, y) {
  var cp1x = x0 + 2 / 3 * (x1 - x0);
  var cp1y = y0 + 2 / 3 * (y1 - y0);
  var cp2x = cp1x + 1 / 3 * (x - x0);
  var cp2y = cp1y + 1 / 3 * (y - y0);
  this.addBezier(x0, y0, cp1x, cp1y, cp2x, cp2y, x, y);
};
function Path() {
  this.commands = [];
  this.fill = "black";
  this.stroke = null;
  this.strokeWidth = 1;
}
Path.prototype.moveTo = function(x, y) {
  this.commands.push({
    type: "M",
    x,
    y
  });
};
Path.prototype.lineTo = function(x, y) {
  this.commands.push({
    type: "L",
    x,
    y
  });
};
Path.prototype.curveTo = Path.prototype.bezierCurveTo = function(x1, y1, x2, y2, x, y) {
  this.commands.push({
    type: "C",
    x1,
    y1,
    x2,
    y2,
    x,
    y
  });
};
Path.prototype.quadTo = Path.prototype.quadraticCurveTo = function(x1, y1, x, y) {
  this.commands.push({
    type: "Q",
    x1,
    y1,
    x,
    y
  });
};
Path.prototype.close = Path.prototype.closePath = function() {
  this.commands.push({
    type: "Z"
  });
};
Path.prototype.extend = function(pathOrCommands) {
  if (pathOrCommands.commands) {
    pathOrCommands = pathOrCommands.commands;
  } else if (pathOrCommands instanceof BoundingBox) {
    var box = pathOrCommands;
    this.moveTo(box.x1, box.y1);
    this.lineTo(box.x2, box.y1);
    this.lineTo(box.x2, box.y2);
    this.lineTo(box.x1, box.y2);
    this.close();
    return;
  }
  Array.prototype.push.apply(this.commands, pathOrCommands);
};
Path.prototype.getBoundingBox = function() {
  var box = new BoundingBox();
  var startX = 0;
  var startY = 0;
  var prevX = 0;
  var prevY = 0;
  for (var i = 0; i < this.commands.length; i++) {
    var cmd = this.commands[i];
    switch (cmd.type) {
      case "M":
        box.addPoint(cmd.x, cmd.y);
        startX = prevX = cmd.x;
        startY = prevY = cmd.y;
        break;
      case "L":
        box.addPoint(cmd.x, cmd.y);
        prevX = cmd.x;
        prevY = cmd.y;
        break;
      case "Q":
        box.addQuad(prevX, prevY, cmd.x1, cmd.y1, cmd.x, cmd.y);
        prevX = cmd.x;
        prevY = cmd.y;
        break;
      case "C":
        box.addBezier(prevX, prevY, cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y);
        prevX = cmd.x;
        prevY = cmd.y;
        break;
      case "Z":
        prevX = startX;
        prevY = startY;
        break;
      default:
        throw new Error("Unexpected path command " + cmd.type);
    }
  }
  if (box.isEmpty()) {
    box.addPoint(0, 0);
  }
  return box;
};
Path.prototype.draw = function(ctx) {
  ctx.beginPath();
  for (var i = 0; i < this.commands.length; i += 1) {
    var cmd = this.commands[i];
    if (cmd.type === "M") {
      ctx.moveTo(cmd.x, cmd.y);
    } else if (cmd.type === "L") {
      ctx.lineTo(cmd.x, cmd.y);
    } else if (cmd.type === "C") {
      ctx.bezierCurveTo(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y);
    } else if (cmd.type === "Q") {
      ctx.quadraticCurveTo(cmd.x1, cmd.y1, cmd.x, cmd.y);
    } else if (cmd.type === "Z") {
      ctx.closePath();
    }
  }
  if (this.fill) {
    ctx.fillStyle = this.fill;
    ctx.fill();
  }
  if (this.stroke) {
    ctx.strokeStyle = this.stroke;
    ctx.lineWidth = this.strokeWidth;
    ctx.stroke();
  }
};
Path.prototype.toPathData = function(decimalPlaces) {
  decimalPlaces = decimalPlaces !== void 0 ? decimalPlaces : 2;
  function floatToString(v) {
    if (Math.round(v) === v) {
      return "" + Math.round(v);
    } else {
      return v.toFixed(decimalPlaces);
    }
  }
  function packValues() {
    var arguments$1 = arguments;
    var s = "";
    for (var i2 = 0; i2 < arguments.length; i2 += 1) {
      var v = arguments$1[i2];
      if (v >= 0 && i2 > 0) {
        s += " ";
      }
      s += floatToString(v);
    }
    return s;
  }
  var d = "";
  for (var i = 0; i < this.commands.length; i += 1) {
    var cmd = this.commands[i];
    if (cmd.type === "M") {
      d += "M" + packValues(cmd.x, cmd.y);
    } else if (cmd.type === "L") {
      d += "L" + packValues(cmd.x, cmd.y);
    } else if (cmd.type === "C") {
      d += "C" + packValues(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y);
    } else if (cmd.type === "Q") {
      d += "Q" + packValues(cmd.x1, cmd.y1, cmd.x, cmd.y);
    } else if (cmd.type === "Z") {
      d += "Z";
    }
  }
  return d;
};
Path.prototype.toSVG = function(decimalPlaces) {
  var svg = '<path d="';
  svg += this.toPathData(decimalPlaces);
  svg += '"';
  if (this.fill && this.fill !== "black") {
    if (this.fill === null) {
      svg += ' fill="none"';
    } else {
      svg += ' fill="' + this.fill + '"';
    }
  }
  if (this.stroke) {
    svg += ' stroke="' + this.stroke + '" stroke-width="' + this.strokeWidth + '"';
  }
  svg += "/>";
  return svg;
};
Path.prototype.toDOMElement = function(decimalPlaces) {
  var temporaryPath = this.toPathData(decimalPlaces);
  var newPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  newPath.setAttribute("d", temporaryPath);
  return newPath;
};
function fail(message) {
  throw new Error(message);
}
function argument(predicate, message) {
  if (!predicate) {
    fail(message);
  }
}
var check = { fail, argument, assert: argument };
var LIMIT16 = 32768;
var LIMIT32 = 2147483648;
var decode = {};
var encode = {};
var sizeOf = {};
function constant(v) {
  return function() {
    return v;
  };
}
encode.BYTE = function(v) {
  check.argument(v >= 0 && v <= 255, "Byte value should be between 0 and 255.");
  return [v];
};
sizeOf.BYTE = constant(1);
encode.CHAR = function(v) {
  return [v.charCodeAt(0)];
};
sizeOf.CHAR = constant(1);
encode.CHARARRAY = function(v) {
  if (typeof v === "undefined") {
    v = "";
    console.warn("Undefined CHARARRAY encountered and treated as an empty string. This is probably caused by a missing glyph name.");
  }
  var b = [];
  for (var i = 0; i < v.length; i += 1) {
    b[i] = v.charCodeAt(i);
  }
  return b;
};
sizeOf.CHARARRAY = function(v) {
  if (typeof v === "undefined") {
    return 0;
  }
  return v.length;
};
encode.USHORT = function(v) {
  return [v >> 8 & 255, v & 255];
};
sizeOf.USHORT = constant(2);
encode.SHORT = function(v) {
  if (v >= LIMIT16) {
    v = -(2 * LIMIT16 - v);
  }
  return [v >> 8 & 255, v & 255];
};
sizeOf.SHORT = constant(2);
encode.UINT24 = function(v) {
  return [v >> 16 & 255, v >> 8 & 255, v & 255];
};
sizeOf.UINT24 = constant(3);
encode.ULONG = function(v) {
  return [v >> 24 & 255, v >> 16 & 255, v >> 8 & 255, v & 255];
};
sizeOf.ULONG = constant(4);
encode.LONG = function(v) {
  if (v >= LIMIT32) {
    v = -(2 * LIMIT32 - v);
  }
  return [v >> 24 & 255, v >> 16 & 255, v >> 8 & 255, v & 255];
};
sizeOf.LONG = constant(4);
encode.FIXED = encode.ULONG;
sizeOf.FIXED = sizeOf.ULONG;
encode.FWORD = encode.SHORT;
sizeOf.FWORD = sizeOf.SHORT;
encode.UFWORD = encode.USHORT;
sizeOf.UFWORD = sizeOf.USHORT;
encode.LONGDATETIME = function(v) {
  return [0, 0, 0, 0, v >> 24 & 255, v >> 16 & 255, v >> 8 & 255, v & 255];
};
sizeOf.LONGDATETIME = constant(8);
encode.TAG = function(v) {
  check.argument(v.length === 4, "Tag should be exactly 4 ASCII characters.");
  return [
    v.charCodeAt(0),
    v.charCodeAt(1),
    v.charCodeAt(2),
    v.charCodeAt(3)
  ];
};
sizeOf.TAG = constant(4);
encode.Card8 = encode.BYTE;
sizeOf.Card8 = sizeOf.BYTE;
encode.Card16 = encode.USHORT;
sizeOf.Card16 = sizeOf.USHORT;
encode.OffSize = encode.BYTE;
sizeOf.OffSize = sizeOf.BYTE;
encode.SID = encode.USHORT;
sizeOf.SID = sizeOf.USHORT;
encode.NUMBER = function(v) {
  if (v >= -107 && v <= 107) {
    return [v + 139];
  } else if (v >= 108 && v <= 1131) {
    v = v - 108;
    return [(v >> 8) + 247, v & 255];
  } else if (v >= -1131 && v <= -108) {
    v = -v - 108;
    return [(v >> 8) + 251, v & 255];
  } else if (v >= -32768 && v <= 32767) {
    return encode.NUMBER16(v);
  } else {
    return encode.NUMBER32(v);
  }
};
sizeOf.NUMBER = function(v) {
  return encode.NUMBER(v).length;
};
encode.NUMBER16 = function(v) {
  return [28, v >> 8 & 255, v & 255];
};
sizeOf.NUMBER16 = constant(3);
encode.NUMBER32 = function(v) {
  return [29, v >> 24 & 255, v >> 16 & 255, v >> 8 & 255, v & 255];
};
sizeOf.NUMBER32 = constant(5);
encode.REAL = function(v) {
  var value = v.toString();
  var m = /\.(\d*?)(?:9{5,20}|0{5,20})\d{0,2}(?:e(.+)|$)/.exec(value);
  if (m) {
    var epsilon = parseFloat("1e" + ((m[2] ? +m[2] : 0) + m[1].length));
    value = (Math.round(v * epsilon) / epsilon).toString();
  }
  var nibbles = "";
  for (var i = 0, ii = value.length; i < ii; i += 1) {
    var c = value[i];
    if (c === "e") {
      nibbles += value[++i] === "-" ? "c" : "b";
    } else if (c === ".") {
      nibbles += "a";
    } else if (c === "-") {
      nibbles += "e";
    } else {
      nibbles += c;
    }
  }
  nibbles += nibbles.length & 1 ? "f" : "ff";
  var out = [30];
  for (var i$1 = 0, ii$1 = nibbles.length; i$1 < ii$1; i$1 += 2) {
    out.push(parseInt(nibbles.substr(i$1, 2), 16));
  }
  return out;
};
sizeOf.REAL = function(v) {
  return encode.REAL(v).length;
};
encode.NAME = encode.CHARARRAY;
sizeOf.NAME = sizeOf.CHARARRAY;
encode.STRING = encode.CHARARRAY;
sizeOf.STRING = sizeOf.CHARARRAY;
decode.UTF8 = function(data, offset, numBytes) {
  var codePoints = [];
  var numChars = numBytes;
  for (var j = 0; j < numChars; j++, offset += 1) {
    codePoints[j] = data.getUint8(offset);
  }
  return String.fromCharCode.apply(null, codePoints);
};
decode.UTF16 = function(data, offset, numBytes) {
  var codePoints = [];
  var numChars = numBytes / 2;
  for (var j = 0; j < numChars; j++, offset += 2) {
    codePoints[j] = data.getUint16(offset);
  }
  return String.fromCharCode.apply(null, codePoints);
};
encode.UTF16 = function(v) {
  var b = [];
  for (var i = 0; i < v.length; i += 1) {
    var codepoint = v.charCodeAt(i);
    b[b.length] = codepoint >> 8 & 255;
    b[b.length] = codepoint & 255;
  }
  return b;
};
sizeOf.UTF16 = function(v) {
  return v.length * 2;
};
var eightBitMacEncodings = {
  "x-mac-croatian": (
    // Python: 'mac_croatian'
    "\xC4\xC5\xC7\xC9\xD1\xD6\xDC\xE1\xE0\xE2\xE4\xE3\xE5\xE7\xE9\xE8\xEA\xEB\xED\xEC\xEE\xEF\xF1\xF3\xF2\xF4\xF6\xF5\xFA\xF9\xFB\xFC\u2020\xB0\xA2\xA3\xA7\u2022\xB6\xDF\xAE\u0160\u2122\xB4\xA8\u2260\u017D\xD8\u221E\xB1\u2264\u2265\u2206\xB5\u2202\u2211\u220F\u0161\u222B\xAA\xBA\u03A9\u017E\xF8\xBF\xA1\xAC\u221A\u0192\u2248\u0106\xAB\u010C\u2026\xA0\xC0\xC3\xD5\u0152\u0153\u0110\u2014\u201C\u201D\u2018\u2019\xF7\u25CA\uF8FF\xA9\u2044\u20AC\u2039\u203A\xC6\xBB\u2013\xB7\u201A\u201E\u2030\xC2\u0107\xC1\u010D\xC8\xCD\xCE\xCF\xCC\xD3\xD4\u0111\xD2\xDA\xDB\xD9\u0131\u02C6\u02DC\xAF\u03C0\xCB\u02DA\xB8\xCA\xE6\u02C7"
  ),
  "x-mac-cyrillic": (
    // Python: 'mac_cyrillic'
    "\u0410\u0411\u0412\u0413\u0414\u0415\u0416\u0417\u0418\u0419\u041A\u041B\u041C\u041D\u041E\u041F\u0420\u0421\u0422\u0423\u0424\u0425\u0426\u0427\u0428\u0429\u042A\u042B\u042C\u042D\u042E\u042F\u2020\xB0\u0490\xA3\xA7\u2022\xB6\u0406\xAE\xA9\u2122\u0402\u0452\u2260\u0403\u0453\u221E\xB1\u2264\u2265\u0456\xB5\u0491\u0408\u0404\u0454\u0407\u0457\u0409\u0459\u040A\u045A\u0458\u0405\xAC\u221A\u0192\u2248\u2206\xAB\xBB\u2026\xA0\u040B\u045B\u040C\u045C\u0455\u2013\u2014\u201C\u201D\u2018\u2019\xF7\u201E\u040E\u045E\u040F\u045F\u2116\u0401\u0451\u044F\u0430\u0431\u0432\u0433\u0434\u0435\u0436\u0437\u0438\u0439\u043A\u043B\u043C\u043D\u043E\u043F\u0440\u0441\u0442\u0443\u0444\u0445\u0446\u0447\u0448\u0449\u044A\u044B\u044C\u044D\u044E"
  ),
  "x-mac-gaelic": (
    // http://unicode.org/Public/MAPPINGS/VENDORS/APPLE/GAELIC.TXT
    "\xC4\xC5\xC7\xC9\xD1\xD6\xDC\xE1\xE0\xE2\xE4\xE3\xE5\xE7\xE9\xE8\xEA\xEB\xED\xEC\xEE\xEF\xF1\xF3\xF2\xF4\xF6\xF5\xFA\xF9\xFB\xFC\u2020\xB0\xA2\xA3\xA7\u2022\xB6\xDF\xAE\xA9\u2122\xB4\xA8\u2260\xC6\xD8\u1E02\xB1\u2264\u2265\u1E03\u010A\u010B\u1E0A\u1E0B\u1E1E\u1E1F\u0120\u0121\u1E40\xE6\xF8\u1E41\u1E56\u1E57\u027C\u0192\u017F\u1E60\xAB\xBB\u2026\xA0\xC0\xC3\xD5\u0152\u0153\u2013\u2014\u201C\u201D\u2018\u2019\u1E61\u1E9B\xFF\u0178\u1E6A\u20AC\u2039\u203A\u0176\u0177\u1E6B\xB7\u1EF2\u1EF3\u204A\xC2\xCA\xC1\xCB\xC8\xCD\xCE\xCF\xCC\xD3\xD4\u2663\xD2\xDA\xDB\xD9\u0131\xDD\xFD\u0174\u0175\u1E84\u1E85\u1E80\u1E81\u1E82\u1E83"
  ),
  "x-mac-greek": (
    // Python: 'mac_greek'
    "\xC4\xB9\xB2\xC9\xB3\xD6\xDC\u0385\xE0\xE2\xE4\u0384\xA8\xE7\xE9\xE8\xEA\xEB\xA3\u2122\xEE\xEF\u2022\xBD\u2030\xF4\xF6\xA6\u20AC\xF9\xFB\xFC\u2020\u0393\u0394\u0398\u039B\u039E\u03A0\xDF\xAE\xA9\u03A3\u03AA\xA7\u2260\xB0\xB7\u0391\xB1\u2264\u2265\xA5\u0392\u0395\u0396\u0397\u0399\u039A\u039C\u03A6\u03AB\u03A8\u03A9\u03AC\u039D\xAC\u039F\u03A1\u2248\u03A4\xAB\xBB\u2026\xA0\u03A5\u03A7\u0386\u0388\u0153\u2013\u2015\u201C\u201D\u2018\u2019\xF7\u0389\u038A\u038C\u038E\u03AD\u03AE\u03AF\u03CC\u038F\u03CD\u03B1\u03B2\u03C8\u03B4\u03B5\u03C6\u03B3\u03B7\u03B9\u03BE\u03BA\u03BB\u03BC\u03BD\u03BF\u03C0\u03CE\u03C1\u03C3\u03C4\u03B8\u03C9\u03C2\u03C7\u03C5\u03B6\u03CA\u03CB\u0390\u03B0\xAD"
  ),
  "x-mac-icelandic": (
    // Python: 'mac_iceland'
    "\xC4\xC5\xC7\xC9\xD1\xD6\xDC\xE1\xE0\xE2\xE4\xE3\xE5\xE7\xE9\xE8\xEA\xEB\xED\xEC\xEE\xEF\xF1\xF3\xF2\xF4\xF6\xF5\xFA\xF9\xFB\xFC\xDD\xB0\xA2\xA3\xA7\u2022\xB6\xDF\xAE\xA9\u2122\xB4\xA8\u2260\xC6\xD8\u221E\xB1\u2264\u2265\xA5\xB5\u2202\u2211\u220F\u03C0\u222B\xAA\xBA\u03A9\xE6\xF8\xBF\xA1\xAC\u221A\u0192\u2248\u2206\xAB\xBB\u2026\xA0\xC0\xC3\xD5\u0152\u0153\u2013\u2014\u201C\u201D\u2018\u2019\xF7\u25CA\xFF\u0178\u2044\u20AC\xD0\xF0\xDE\xFE\xFD\xB7\u201A\u201E\u2030\xC2\xCA\xC1\xCB\xC8\xCD\xCE\xCF\xCC\xD3\xD4\uF8FF\xD2\xDA\xDB\xD9\u0131\u02C6\u02DC\xAF\u02D8\u02D9\u02DA\xB8\u02DD\u02DB\u02C7"
  ),
  "x-mac-inuit": (
    // http://unicode.org/Public/MAPPINGS/VENDORS/APPLE/INUIT.TXT
    "\u1403\u1404\u1405\u1406\u140A\u140B\u1431\u1432\u1433\u1434\u1438\u1439\u1449\u144E\u144F\u1450\u1451\u1455\u1456\u1466\u146D\u146E\u146F\u1470\u1472\u1473\u1483\u148B\u148C\u148D\u148E\u1490\u1491\xB0\u14A1\u14A5\u14A6\u2022\xB6\u14A7\xAE\xA9\u2122\u14A8\u14AA\u14AB\u14BB\u14C2\u14C3\u14C4\u14C5\u14C7\u14C8\u14D0\u14EF\u14F0\u14F1\u14F2\u14F4\u14F5\u1505\u14D5\u14D6\u14D7\u14D8\u14DA\u14DB\u14EA\u1528\u1529\u152A\u152B\u152D\u2026\xA0\u152E\u153E\u1555\u1556\u1557\u2013\u2014\u201C\u201D\u2018\u2019\u1558\u1559\u155A\u155D\u1546\u1547\u1548\u1549\u154B\u154C\u1550\u157F\u1580\u1581\u1582\u1583\u1584\u1585\u158F\u1590\u1591\u1592\u1593\u1594\u1595\u1671\u1672\u1673\u1674\u1675\u1676\u1596\u15A0\u15A1\u15A2\u15A3\u15A4\u15A5\u15A6\u157C\u0141\u0142"
  ),
  "x-mac-ce": (
    // Python: 'mac_latin2'
    "\xC4\u0100\u0101\xC9\u0104\xD6\xDC\xE1\u0105\u010C\xE4\u010D\u0106\u0107\xE9\u0179\u017A\u010E\xED\u010F\u0112\u0113\u0116\xF3\u0117\xF4\xF6\xF5\xFA\u011A\u011B\xFC\u2020\xB0\u0118\xA3\xA7\u2022\xB6\xDF\xAE\xA9\u2122\u0119\xA8\u2260\u0123\u012E\u012F\u012A\u2264\u2265\u012B\u0136\u2202\u2211\u0142\u013B\u013C\u013D\u013E\u0139\u013A\u0145\u0146\u0143\xAC\u221A\u0144\u0147\u2206\xAB\xBB\u2026\xA0\u0148\u0150\xD5\u0151\u014C\u2013\u2014\u201C\u201D\u2018\u2019\xF7\u25CA\u014D\u0154\u0155\u0158\u2039\u203A\u0159\u0156\u0157\u0160\u201A\u201E\u0161\u015A\u015B\xC1\u0164\u0165\xCD\u017D\u017E\u016A\xD3\xD4\u016B\u016E\xDA\u016F\u0170\u0171\u0172\u0173\xDD\xFD\u0137\u017B\u0141\u017C\u0122\u02C7"
  ),
  macintosh: (
    // Python: 'mac_roman'
    "\xC4\xC5\xC7\xC9\xD1\xD6\xDC\xE1\xE0\xE2\xE4\xE3\xE5\xE7\xE9\xE8\xEA\xEB\xED\xEC\xEE\xEF\xF1\xF3\xF2\xF4\xF6\xF5\xFA\xF9\xFB\xFC\u2020\xB0\xA2\xA3\xA7\u2022\xB6\xDF\xAE\xA9\u2122\xB4\xA8\u2260\xC6\xD8\u221E\xB1\u2264\u2265\xA5\xB5\u2202\u2211\u220F\u03C0\u222B\xAA\xBA\u03A9\xE6\xF8\xBF\xA1\xAC\u221A\u0192\u2248\u2206\xAB\xBB\u2026\xA0\xC0\xC3\xD5\u0152\u0153\u2013\u2014\u201C\u201D\u2018\u2019\xF7\u25CA\xFF\u0178\u2044\u20AC\u2039\u203A\uFB01\uFB02\u2021\xB7\u201A\u201E\u2030\xC2\xCA\xC1\xCB\xC8\xCD\xCE\xCF\xCC\xD3\xD4\uF8FF\xD2\xDA\xDB\xD9\u0131\u02C6\u02DC\xAF\u02D8\u02D9\u02DA\xB8\u02DD\u02DB\u02C7"
  ),
  "x-mac-romanian": (
    // Python: 'mac_romanian'
    "\xC4\xC5\xC7\xC9\xD1\xD6\xDC\xE1\xE0\xE2\xE4\xE3\xE5\xE7\xE9\xE8\xEA\xEB\xED\xEC\xEE\xEF\xF1\xF3\xF2\xF4\xF6\xF5\xFA\xF9\xFB\xFC\u2020\xB0\xA2\xA3\xA7\u2022\xB6\xDF\xAE\xA9\u2122\xB4\xA8\u2260\u0102\u0218\u221E\xB1\u2264\u2265\xA5\xB5\u2202\u2211\u220F\u03C0\u222B\xAA\xBA\u03A9\u0103\u0219\xBF\xA1\xAC\u221A\u0192\u2248\u2206\xAB\xBB\u2026\xA0\xC0\xC3\xD5\u0152\u0153\u2013\u2014\u201C\u201D\u2018\u2019\xF7\u25CA\xFF\u0178\u2044\u20AC\u2039\u203A\u021A\u021B\u2021\xB7\u201A\u201E\u2030\xC2\xCA\xC1\xCB\xC8\xCD\xCE\xCF\xCC\xD3\xD4\uF8FF\xD2\xDA\xDB\xD9\u0131\u02C6\u02DC\xAF\u02D8\u02D9\u02DA\xB8\u02DD\u02DB\u02C7"
  ),
  "x-mac-turkish": (
    // Python: 'mac_turkish'
    "\xC4\xC5\xC7\xC9\xD1\xD6\xDC\xE1\xE0\xE2\xE4\xE3\xE5\xE7\xE9\xE8\xEA\xEB\xED\xEC\xEE\xEF\xF1\xF3\xF2\xF4\xF6\xF5\xFA\xF9\xFB\xFC\u2020\xB0\xA2\xA3\xA7\u2022\xB6\xDF\xAE\xA9\u2122\xB4\xA8\u2260\xC6\xD8\u221E\xB1\u2264\u2265\xA5\xB5\u2202\u2211\u220F\u03C0\u222B\xAA\xBA\u03A9\xE6\xF8\xBF\xA1\xAC\u221A\u0192\u2248\u2206\xAB\xBB\u2026\xA0\xC0\xC3\xD5\u0152\u0153\u2013\u2014\u201C\u201D\u2018\u2019\xF7\u25CA\xFF\u0178\u011E\u011F\u0130\u0131\u015E\u015F\u2021\xB7\u201A\u201E\u2030\xC2\xCA\xC1\xCB\xC8\xCD\xCE\xCF\xCC\xD3\xD4\uF8FF\xD2\xDA\xDB\xD9\uF8A0\u02C6\u02DC\xAF\u02D8\u02D9\u02DA\xB8\u02DD\u02DB\u02C7"
  )
};
decode.MACSTRING = function(dataView, offset, dataLength, encoding) {
  var table2 = eightBitMacEncodings[encoding];
  if (table2 === void 0) {
    return void 0;
  }
  var result = "";
  for (var i = 0; i < dataLength; i++) {
    var c = dataView.getUint8(offset + i);
    if (c <= 127) {
      result += String.fromCharCode(c);
    } else {
      result += table2[c & 127];
    }
  }
  return result;
};
var macEncodingTableCache = typeof WeakMap === "function" && /* @__PURE__ */ new WeakMap();
var macEncodingCacheKeys;
var getMacEncodingTable = function(encoding) {
  if (!macEncodingCacheKeys) {
    macEncodingCacheKeys = {};
    for (var e in eightBitMacEncodings) {
      macEncodingCacheKeys[e] = new String(e);
    }
  }
  var cacheKey = macEncodingCacheKeys[encoding];
  if (cacheKey === void 0) {
    return void 0;
  }
  if (macEncodingTableCache) {
    var cachedTable = macEncodingTableCache.get(cacheKey);
    if (cachedTable !== void 0) {
      return cachedTable;
    }
  }
  var decodingTable = eightBitMacEncodings[encoding];
  if (decodingTable === void 0) {
    return void 0;
  }
  var encodingTable = {};
  for (var i = 0; i < decodingTable.length; i++) {
    encodingTable[decodingTable.charCodeAt(i)] = i + 128;
  }
  if (macEncodingTableCache) {
    macEncodingTableCache.set(cacheKey, encodingTable);
  }
  return encodingTable;
};
encode.MACSTRING = function(str, encoding) {
  var table2 = getMacEncodingTable(encoding);
  if (table2 === void 0) {
    return void 0;
  }
  var result = [];
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c >= 128) {
      c = table2[c];
      if (c === void 0) {
        return void 0;
      }
    }
    result[i] = c;
  }
  return result;
};
sizeOf.MACSTRING = function(str, encoding) {
  var b = encode.MACSTRING(str, encoding);
  if (b !== void 0) {
    return b.length;
  } else {
    return 0;
  }
};
function isByteEncodable(value) {
  return value >= -128 && value <= 127;
}
function encodeVarDeltaRunAsZeroes(deltas, pos, result) {
  var runLength = 0;
  var numDeltas = deltas.length;
  while (pos < numDeltas && runLength < 64 && deltas[pos] === 0) {
    ++pos;
    ++runLength;
  }
  result.push(128 | runLength - 1);
  return pos;
}
function encodeVarDeltaRunAsBytes(deltas, offset, result) {
  var runLength = 0;
  var numDeltas = deltas.length;
  var pos = offset;
  while (pos < numDeltas && runLength < 64) {
    var value = deltas[pos];
    if (!isByteEncodable(value)) {
      break;
    }
    if (value === 0 && pos + 1 < numDeltas && deltas[pos + 1] === 0) {
      break;
    }
    ++pos;
    ++runLength;
  }
  result.push(runLength - 1);
  for (var i = offset; i < pos; ++i) {
    result.push(deltas[i] + 256 & 255);
  }
  return pos;
}
function encodeVarDeltaRunAsWords(deltas, offset, result) {
  var runLength = 0;
  var numDeltas = deltas.length;
  var pos = offset;
  while (pos < numDeltas && runLength < 64) {
    var value = deltas[pos];
    if (value === 0) {
      break;
    }
    if (isByteEncodable(value) && pos + 1 < numDeltas && isByteEncodable(deltas[pos + 1])) {
      break;
    }
    ++pos;
    ++runLength;
  }
  result.push(64 | runLength - 1);
  for (var i = offset; i < pos; ++i) {
    var val = deltas[i];
    result.push(val + 65536 >> 8 & 255, val + 256 & 255);
  }
  return pos;
}
encode.VARDELTAS = function(deltas) {
  var pos = 0;
  var result = [];
  while (pos < deltas.length) {
    var value = deltas[pos];
    if (value === 0) {
      pos = encodeVarDeltaRunAsZeroes(deltas, pos, result);
    } else if (value >= -128 && value <= 127) {
      pos = encodeVarDeltaRunAsBytes(deltas, pos, result);
    } else {
      pos = encodeVarDeltaRunAsWords(deltas, pos, result);
    }
  }
  return result;
};
encode.INDEX = function(l) {
  var offset = 1;
  var offsets = [offset];
  var data = [];
  for (var i = 0; i < l.length; i += 1) {
    var v = encode.OBJECT(l[i]);
    Array.prototype.push.apply(data, v);
    offset += v.length;
    offsets.push(offset);
  }
  if (data.length === 0) {
    return [0, 0];
  }
  var encodedOffsets = [];
  var offSize = 1 + Math.floor(Math.log(offset) / Math.log(2)) / 8 | 0;
  var offsetEncoder = [void 0, encode.BYTE, encode.USHORT, encode.UINT24, encode.ULONG][offSize];
  for (var i$1 = 0; i$1 < offsets.length; i$1 += 1) {
    var encodedOffset = offsetEncoder(offsets[i$1]);
    Array.prototype.push.apply(encodedOffsets, encodedOffset);
  }
  return Array.prototype.concat(
    encode.Card16(l.length),
    encode.OffSize(offSize),
    encodedOffsets,
    data
  );
};
sizeOf.INDEX = function(v) {
  return encode.INDEX(v).length;
};
encode.DICT = function(m) {
  var d = [];
  var keys = Object.keys(m);
  var length = keys.length;
  for (var i = 0; i < length; i += 1) {
    var k = parseInt(keys[i], 0);
    var v = m[k];
    d = d.concat(encode.OPERAND(v.value, v.type));
    d = d.concat(encode.OPERATOR(k));
  }
  return d;
};
sizeOf.DICT = function(m) {
  return encode.DICT(m).length;
};
encode.OPERATOR = function(v) {
  if (v < 1200) {
    return [v];
  } else {
    return [12, v - 1200];
  }
};
encode.OPERAND = function(v, type) {
  var d = [];
  if (Array.isArray(type)) {
    for (var i = 0; i < type.length; i += 1) {
      check.argument(v.length === type.length, "Not enough arguments given for type" + type);
      d = d.concat(encode.OPERAND(v[i], type[i]));
    }
  } else {
    if (type === "SID") {
      d = d.concat(encode.NUMBER(v));
    } else if (type === "offset") {
      d = d.concat(encode.NUMBER32(v));
    } else if (type === "number") {
      d = d.concat(encode.NUMBER(v));
    } else if (type === "real") {
      d = d.concat(encode.REAL(v));
    } else {
      throw new Error("Unknown operand type " + type);
    }
  }
  return d;
};
encode.OP = encode.BYTE;
sizeOf.OP = sizeOf.BYTE;
var wmm = typeof WeakMap === "function" && /* @__PURE__ */ new WeakMap();
encode.CHARSTRING = function(ops) {
  if (wmm) {
    var cachedValue = wmm.get(ops);
    if (cachedValue !== void 0) {
      return cachedValue;
    }
  }
  var d = [];
  var length = ops.length;
  for (var i = 0; i < length; i += 1) {
    var op = ops[i];
    d = d.concat(encode[op.type](op.value));
  }
  if (wmm) {
    wmm.set(ops, d);
  }
  return d;
};
sizeOf.CHARSTRING = function(ops) {
  return encode.CHARSTRING(ops).length;
};
encode.OBJECT = function(v) {
  var encodingFunction = encode[v.type];
  check.argument(encodingFunction !== void 0, "No encoding function for type " + v.type);
  return encodingFunction(v.value);
};
sizeOf.OBJECT = function(v) {
  var sizeOfFunction = sizeOf[v.type];
  check.argument(sizeOfFunction !== void 0, "No sizeOf function for type " + v.type);
  return sizeOfFunction(v.value);
};
encode.TABLE = function(table2) {
  var d = [];
  var length = table2.fields.length;
  var subtables = [];
  var subtableOffsets = [];
  for (var i = 0; i < length; i += 1) {
    var field = table2.fields[i];
    var encodingFunction = encode[field.type];
    check.argument(encodingFunction !== void 0, "No encoding function for field type " + field.type + " (" + field.name + ")");
    var value = table2[field.name];
    if (value === void 0) {
      value = field.value;
    }
    var bytes = encodingFunction(value);
    if (field.type === "TABLE") {
      subtableOffsets.push(d.length);
      d = d.concat([0, 0]);
      subtables.push(bytes);
    } else {
      d = d.concat(bytes);
    }
  }
  for (var i$1 = 0; i$1 < subtables.length; i$1 += 1) {
    var o = subtableOffsets[i$1];
    var offset = d.length;
    check.argument(offset < 65536, "Table " + table2.tableName + " too big.");
    d[o] = offset >> 8;
    d[o + 1] = offset & 255;
    d = d.concat(subtables[i$1]);
  }
  return d;
};
sizeOf.TABLE = function(table2) {
  var numBytes = 0;
  var length = table2.fields.length;
  for (var i = 0; i < length; i += 1) {
    var field = table2.fields[i];
    var sizeOfFunction = sizeOf[field.type];
    check.argument(sizeOfFunction !== void 0, "No sizeOf function for field type " + field.type + " (" + field.name + ")");
    var value = table2[field.name];
    if (value === void 0) {
      value = field.value;
    }
    numBytes += sizeOfFunction(value);
    if (field.type === "TABLE") {
      numBytes += 2;
    }
  }
  return numBytes;
};
encode.RECORD = encode.TABLE;
sizeOf.RECORD = sizeOf.TABLE;
encode.LITERAL = function(v) {
  return v;
};
sizeOf.LITERAL = function(v) {
  return v.length;
};
function Table(tableName, fields, options) {
  if (fields.length && (fields[0].name !== "coverageFormat" || fields[0].value === 1)) {
    for (var i = 0; i < fields.length; i += 1) {
      var field = fields[i];
      this[field.name] = field.value;
    }
  }
  this.tableName = tableName;
  this.fields = fields;
  if (options) {
    var optionKeys = Object.keys(options);
    for (var i$1 = 0; i$1 < optionKeys.length; i$1 += 1) {
      var k = optionKeys[i$1];
      var v = options[k];
      if (this[k] !== void 0) {
        this[k] = v;
      }
    }
  }
}
Table.prototype.encode = function() {
  return encode.TABLE(this);
};
Table.prototype.sizeOf = function() {
  return sizeOf.TABLE(this);
};
function ushortList(itemName, list, count) {
  if (count === void 0) {
    count = list.length;
  }
  var fields = new Array(list.length + 1);
  fields[0] = { name: itemName + "Count", type: "USHORT", value: count };
  for (var i = 0; i < list.length; i++) {
    fields[i + 1] = { name: itemName + i, type: "USHORT", value: list[i] };
  }
  return fields;
}
function tableList(itemName, records, itemCallback) {
  var count = records.length;
  var fields = new Array(count + 1);
  fields[0] = { name: itemName + "Count", type: "USHORT", value: count };
  for (var i = 0; i < count; i++) {
    fields[i + 1] = { name: itemName + i, type: "TABLE", value: itemCallback(records[i], i) };
  }
  return fields;
}
function recordList(itemName, records, itemCallback) {
  var count = records.length;
  var fields = [];
  fields[0] = { name: itemName + "Count", type: "USHORT", value: count };
  for (var i = 0; i < count; i++) {
    fields = fields.concat(itemCallback(records[i], i));
  }
  return fields;
}
function Coverage(coverageTable) {
  if (coverageTable.format === 1) {
    Table.call(
      this,
      "coverageTable",
      [{ name: "coverageFormat", type: "USHORT", value: 1 }].concat(ushortList("glyph", coverageTable.glyphs))
    );
  } else if (coverageTable.format === 2) {
    Table.call(
      this,
      "coverageTable",
      [{ name: "coverageFormat", type: "USHORT", value: 2 }].concat(recordList("rangeRecord", coverageTable.ranges, function(RangeRecord) {
        return [
          { name: "startGlyphID", type: "USHORT", value: RangeRecord.start },
          { name: "endGlyphID", type: "USHORT", value: RangeRecord.end },
          { name: "startCoverageIndex", type: "USHORT", value: RangeRecord.index }
        ];
      }))
    );
  } else {
    check.assert(false, "Coverage format must be 1 or 2.");
  }
}
Coverage.prototype = Object.create(Table.prototype);
Coverage.prototype.constructor = Coverage;
function ScriptList(scriptListTable) {
  Table.call(
    this,
    "scriptListTable",
    recordList("scriptRecord", scriptListTable, function(scriptRecord, i) {
      var script = scriptRecord.script;
      var defaultLangSys = script.defaultLangSys;
      check.assert(!!defaultLangSys, "Unable to write GSUB: script " + scriptRecord.tag + " has no default language system.");
      return [
        { name: "scriptTag" + i, type: "TAG", value: scriptRecord.tag },
        { name: "script" + i, type: "TABLE", value: new Table("scriptTable", [
          { name: "defaultLangSys", type: "TABLE", value: new Table("defaultLangSys", [
            { name: "lookupOrder", type: "USHORT", value: 0 },
            { name: "reqFeatureIndex", type: "USHORT", value: defaultLangSys.reqFeatureIndex }
          ].concat(ushortList("featureIndex", defaultLangSys.featureIndexes))) }
        ].concat(recordList("langSys", script.langSysRecords, function(langSysRecord, i2) {
          var langSys = langSysRecord.langSys;
          return [
            { name: "langSysTag" + i2, type: "TAG", value: langSysRecord.tag },
            { name: "langSys" + i2, type: "TABLE", value: new Table("langSys", [
              { name: "lookupOrder", type: "USHORT", value: 0 },
              { name: "reqFeatureIndex", type: "USHORT", value: langSys.reqFeatureIndex }
            ].concat(ushortList("featureIndex", langSys.featureIndexes))) }
          ];
        }))) }
      ];
    })
  );
}
ScriptList.prototype = Object.create(Table.prototype);
ScriptList.prototype.constructor = ScriptList;
function FeatureList(featureListTable) {
  Table.call(
    this,
    "featureListTable",
    recordList("featureRecord", featureListTable, function(featureRecord, i) {
      var feature = featureRecord.feature;
      return [
        { name: "featureTag" + i, type: "TAG", value: featureRecord.tag },
        { name: "feature" + i, type: "TABLE", value: new Table("featureTable", [
          { name: "featureParams", type: "USHORT", value: feature.featureParams }
        ].concat(ushortList("lookupListIndex", feature.lookupListIndexes))) }
      ];
    })
  );
}
FeatureList.prototype = Object.create(Table.prototype);
FeatureList.prototype.constructor = FeatureList;
function LookupList(lookupListTable, subtableMakers2) {
  Table.call(this, "lookupListTable", tableList("lookup", lookupListTable, function(lookupTable) {
    var subtableCallback = subtableMakers2[lookupTable.lookupType];
    check.assert(!!subtableCallback, "Unable to write GSUB lookup type " + lookupTable.lookupType + " tables.");
    return new Table("lookupTable", [
      { name: "lookupType", type: "USHORT", value: lookupTable.lookupType },
      { name: "lookupFlag", type: "USHORT", value: lookupTable.lookupFlag }
    ].concat(tableList("subtable", lookupTable.subtables, subtableCallback)));
  }));
}
LookupList.prototype = Object.create(Table.prototype);
LookupList.prototype.constructor = LookupList;
var table = {
  Table,
  Record: Table,
  Coverage,
  ScriptList,
  FeatureList,
  LookupList,
  ushortList,
  tableList,
  recordList
};
function getByte(dataView, offset) {
  return dataView.getUint8(offset);
}
function getUShort(dataView, offset) {
  return dataView.getUint16(offset, false);
}
function getShort(dataView, offset) {
  return dataView.getInt16(offset, false);
}
function getULong(dataView, offset) {
  return dataView.getUint32(offset, false);
}
function getFixed(dataView, offset) {
  var decimal = dataView.getInt16(offset, false);
  var fraction = dataView.getUint16(offset + 2, false);
  return decimal + fraction / 65535;
}
function getTag(dataView, offset) {
  var tag = "";
  for (var i = offset; i < offset + 4; i += 1) {
    tag += String.fromCharCode(dataView.getInt8(i));
  }
  return tag;
}
function getOffset(dataView, offset, offSize) {
  var v = 0;
  for (var i = 0; i < offSize; i += 1) {
    v <<= 8;
    v += dataView.getUint8(offset + i);
  }
  return v;
}
function getBytes(dataView, startOffset, endOffset) {
  var bytes = [];
  for (var i = startOffset; i < endOffset; i += 1) {
    bytes.push(dataView.getUint8(i));
  }
  return bytes;
}
function bytesToString(bytes) {
  var s = "";
  for (var i = 0; i < bytes.length; i += 1) {
    s += String.fromCharCode(bytes[i]);
  }
  return s;
}
var typeOffsets = {
  byte: 1,
  uShort: 2,
  short: 2,
  uLong: 4,
  fixed: 4,
  longDateTime: 8,
  tag: 4
};
function Parser(data, offset) {
  this.data = data;
  this.offset = offset;
  this.relativeOffset = 0;
}
Parser.prototype.parseByte = function() {
  var v = this.data.getUint8(this.offset + this.relativeOffset);
  this.relativeOffset += 1;
  return v;
};
Parser.prototype.parseChar = function() {
  var v = this.data.getInt8(this.offset + this.relativeOffset);
  this.relativeOffset += 1;
  return v;
};
Parser.prototype.parseCard8 = Parser.prototype.parseByte;
Parser.prototype.parseUShort = function() {
  var v = this.data.getUint16(this.offset + this.relativeOffset);
  this.relativeOffset += 2;
  return v;
};
Parser.prototype.parseCard16 = Parser.prototype.parseUShort;
Parser.prototype.parseSID = Parser.prototype.parseUShort;
Parser.prototype.parseOffset16 = Parser.prototype.parseUShort;
Parser.prototype.parseShort = function() {
  var v = this.data.getInt16(this.offset + this.relativeOffset);
  this.relativeOffset += 2;
  return v;
};
Parser.prototype.parseF2Dot14 = function() {
  var v = this.data.getInt16(this.offset + this.relativeOffset) / 16384;
  this.relativeOffset += 2;
  return v;
};
Parser.prototype.parseULong = function() {
  var v = getULong(this.data, this.offset + this.relativeOffset);
  this.relativeOffset += 4;
  return v;
};
Parser.prototype.parseOffset32 = Parser.prototype.parseULong;
Parser.prototype.parseFixed = function() {
  var v = getFixed(this.data, this.offset + this.relativeOffset);
  this.relativeOffset += 4;
  return v;
};
Parser.prototype.parseString = function(length) {
  var dataView = this.data;
  var offset = this.offset + this.relativeOffset;
  var string = "";
  this.relativeOffset += length;
  for (var i = 0; i < length; i++) {
    string += String.fromCharCode(dataView.getUint8(offset + i));
  }
  return string;
};
Parser.prototype.parseTag = function() {
  return this.parseString(4);
};
Parser.prototype.parseLongDateTime = function() {
  var v = getULong(this.data, this.offset + this.relativeOffset + 4);
  v -= 2082844800;
  this.relativeOffset += 8;
  return v;
};
Parser.prototype.parseVersion = function(minorBase) {
  var major = getUShort(this.data, this.offset + this.relativeOffset);
  var minor = getUShort(this.data, this.offset + this.relativeOffset + 2);
  this.relativeOffset += 4;
  if (minorBase === void 0) {
    minorBase = 4096;
  }
  return major + minor / minorBase / 10;
};
Parser.prototype.skip = function(type, amount) {
  if (amount === void 0) {
    amount = 1;
  }
  this.relativeOffset += typeOffsets[type] * amount;
};
Parser.prototype.parseULongList = function(count) {
  if (count === void 0) {
    count = this.parseULong();
  }
  var offsets = new Array(count);
  var dataView = this.data;
  var offset = this.offset + this.relativeOffset;
  for (var i = 0; i < count; i++) {
    offsets[i] = dataView.getUint32(offset);
    offset += 4;
  }
  this.relativeOffset += count * 4;
  return offsets;
};
Parser.prototype.parseOffset16List = Parser.prototype.parseUShortList = function(count) {
  if (count === void 0) {
    count = this.parseUShort();
  }
  var offsets = new Array(count);
  var dataView = this.data;
  var offset = this.offset + this.relativeOffset;
  for (var i = 0; i < count; i++) {
    offsets[i] = dataView.getUint16(offset);
    offset += 2;
  }
  this.relativeOffset += count * 2;
  return offsets;
};
Parser.prototype.parseShortList = function(count) {
  var list = new Array(count);
  var dataView = this.data;
  var offset = this.offset + this.relativeOffset;
  for (var i = 0; i < count; i++) {
    list[i] = dataView.getInt16(offset);
    offset += 2;
  }
  this.relativeOffset += count * 2;
  return list;
};
Parser.prototype.parseByteList = function(count) {
  var list = new Array(count);
  var dataView = this.data;
  var offset = this.offset + this.relativeOffset;
  for (var i = 0; i < count; i++) {
    list[i] = dataView.getUint8(offset++);
  }
  this.relativeOffset += count;
  return list;
};
Parser.prototype.parseList = function(count, itemCallback) {
  if (!itemCallback) {
    itemCallback = count;
    count = this.parseUShort();
  }
  var list = new Array(count);
  for (var i = 0; i < count; i++) {
    list[i] = itemCallback.call(this);
  }
  return list;
};
Parser.prototype.parseList32 = function(count, itemCallback) {
  if (!itemCallback) {
    itemCallback = count;
    count = this.parseULong();
  }
  var list = new Array(count);
  for (var i = 0; i < count; i++) {
    list[i] = itemCallback.call(this);
  }
  return list;
};
Parser.prototype.parseRecordList = function(count, recordDescription) {
  if (!recordDescription) {
    recordDescription = count;
    count = this.parseUShort();
  }
  var records = new Array(count);
  var fields = Object.keys(recordDescription);
  for (var i = 0; i < count; i++) {
    var rec = {};
    for (var j = 0; j < fields.length; j++) {
      var fieldName = fields[j];
      var fieldType = recordDescription[fieldName];
      rec[fieldName] = fieldType.call(this);
    }
    records[i] = rec;
  }
  return records;
};
Parser.prototype.parseRecordList32 = function(count, recordDescription) {
  if (!recordDescription) {
    recordDescription = count;
    count = this.parseULong();
  }
  var records = new Array(count);
  var fields = Object.keys(recordDescription);
  for (var i = 0; i < count; i++) {
    var rec = {};
    for (var j = 0; j < fields.length; j++) {
      var fieldName = fields[j];
      var fieldType = recordDescription[fieldName];
      rec[fieldName] = fieldType.call(this);
    }
    records[i] = rec;
  }
  return records;
};
Parser.prototype.parseStruct = function(description) {
  if (typeof description === "function") {
    return description.call(this);
  } else {
    var fields = Object.keys(description);
    var struct = {};
    for (var j = 0; j < fields.length; j++) {
      var fieldName = fields[j];
      var fieldType = description[fieldName];
      struct[fieldName] = fieldType.call(this);
    }
    return struct;
  }
};
Parser.prototype.parseValueRecord = function(valueFormat) {
  if (valueFormat === void 0) {
    valueFormat = this.parseUShort();
  }
  if (valueFormat === 0) {
    return;
  }
  var valueRecord = {};
  if (valueFormat & 1) {
    valueRecord.xPlacement = this.parseShort();
  }
  if (valueFormat & 2) {
    valueRecord.yPlacement = this.parseShort();
  }
  if (valueFormat & 4) {
    valueRecord.xAdvance = this.parseShort();
  }
  if (valueFormat & 8) {
    valueRecord.yAdvance = this.parseShort();
  }
  if (valueFormat & 16) {
    valueRecord.xPlaDevice = void 0;
    this.parseShort();
  }
  if (valueFormat & 32) {
    valueRecord.yPlaDevice = void 0;
    this.parseShort();
  }
  if (valueFormat & 64) {
    valueRecord.xAdvDevice = void 0;
    this.parseShort();
  }
  if (valueFormat & 128) {
    valueRecord.yAdvDevice = void 0;
    this.parseShort();
  }
  return valueRecord;
};
Parser.prototype.parseValueRecordList = function() {
  var valueFormat = this.parseUShort();
  var valueCount = this.parseUShort();
  var values = new Array(valueCount);
  for (var i = 0; i < valueCount; i++) {
    values[i] = this.parseValueRecord(valueFormat);
  }
  return values;
};
Parser.prototype.parsePointer = function(description) {
  var structOffset = this.parseOffset16();
  if (structOffset > 0) {
    return new Parser(this.data, this.offset + structOffset).parseStruct(description);
  }
  return void 0;
};
Parser.prototype.parsePointer32 = function(description) {
  var structOffset = this.parseOffset32();
  if (structOffset > 0) {
    return new Parser(this.data, this.offset + structOffset).parseStruct(description);
  }
  return void 0;
};
Parser.prototype.parseListOfLists = function(itemCallback) {
  var offsets = this.parseOffset16List();
  var count = offsets.length;
  var relativeOffset = this.relativeOffset;
  var list = new Array(count);
  for (var i = 0; i < count; i++) {
    var start = offsets[i];
    if (start === 0) {
      list[i] = void 0;
      continue;
    }
    this.relativeOffset = start;
    if (itemCallback) {
      var subOffsets = this.parseOffset16List();
      var subList = new Array(subOffsets.length);
      for (var j = 0; j < subOffsets.length; j++) {
        this.relativeOffset = start + subOffsets[j];
        subList[j] = itemCallback.call(this);
      }
      list[i] = subList;
    } else {
      list[i] = this.parseUShortList();
    }
  }
  this.relativeOffset = relativeOffset;
  return list;
};
Parser.prototype.parseCoverage = function() {
  var startOffset = this.offset + this.relativeOffset;
  var format = this.parseUShort();
  var count = this.parseUShort();
  if (format === 1) {
    return {
      format: 1,
      glyphs: this.parseUShortList(count)
    };
  } else if (format === 2) {
    var ranges = new Array(count);
    for (var i = 0; i < count; i++) {
      ranges[i] = {
        start: this.parseUShort(),
        end: this.parseUShort(),
        index: this.parseUShort()
      };
    }
    return {
      format: 2,
      ranges
    };
  }
  throw new Error("0x" + startOffset.toString(16) + ": Coverage format must be 1 or 2.");
};
Parser.prototype.parseClassDef = function() {
  var startOffset = this.offset + this.relativeOffset;
  var format = this.parseUShort();
  if (format === 1) {
    return {
      format: 1,
      startGlyph: this.parseUShort(),
      classes: this.parseUShortList()
    };
  } else if (format === 2) {
    return {
      format: 2,
      ranges: this.parseRecordList({
        start: Parser.uShort,
        end: Parser.uShort,
        classId: Parser.uShort
      })
    };
  }
  throw new Error("0x" + startOffset.toString(16) + ": ClassDef format must be 1 or 2.");
};
Parser.list = function(count, itemCallback) {
  return function() {
    return this.parseList(count, itemCallback);
  };
};
Parser.list32 = function(count, itemCallback) {
  return function() {
    return this.parseList32(count, itemCallback);
  };
};
Parser.recordList = function(count, recordDescription) {
  return function() {
    return this.parseRecordList(count, recordDescription);
  };
};
Parser.recordList32 = function(count, recordDescription) {
  return function() {
    return this.parseRecordList32(count, recordDescription);
  };
};
Parser.pointer = function(description) {
  return function() {
    return this.parsePointer(description);
  };
};
Parser.pointer32 = function(description) {
  return function() {
    return this.parsePointer32(description);
  };
};
Parser.tag = Parser.prototype.parseTag;
Parser.byte = Parser.prototype.parseByte;
Parser.uShort = Parser.offset16 = Parser.prototype.parseUShort;
Parser.uShortList = Parser.prototype.parseUShortList;
Parser.uLong = Parser.offset32 = Parser.prototype.parseULong;
Parser.uLongList = Parser.prototype.parseULongList;
Parser.struct = Parser.prototype.parseStruct;
Parser.coverage = Parser.prototype.parseCoverage;
Parser.classDef = Parser.prototype.parseClassDef;
var langSysTable = {
  reserved: Parser.uShort,
  reqFeatureIndex: Parser.uShort,
  featureIndexes: Parser.uShortList
};
Parser.prototype.parseScriptList = function() {
  return this.parsePointer(Parser.recordList({
    tag: Parser.tag,
    script: Parser.pointer({
      defaultLangSys: Parser.pointer(langSysTable),
      langSysRecords: Parser.recordList({
        tag: Parser.tag,
        langSys: Parser.pointer(langSysTable)
      })
    })
  })) || [];
};
Parser.prototype.parseFeatureList = function() {
  return this.parsePointer(Parser.recordList({
    tag: Parser.tag,
    feature: Parser.pointer({
      featureParams: Parser.offset16,
      lookupListIndexes: Parser.uShortList
    })
  })) || [];
};
Parser.prototype.parseLookupList = function(lookupTableParsers) {
  return this.parsePointer(Parser.list(Parser.pointer(function() {
    var lookupType = this.parseUShort();
    check.argument(1 <= lookupType && lookupType <= 9, "GPOS/GSUB lookup type " + lookupType + " unknown.");
    var lookupFlag = this.parseUShort();
    var useMarkFilteringSet = lookupFlag & 16;
    return {
      lookupType,
      lookupFlag,
      subtables: this.parseList(Parser.pointer(lookupTableParsers[lookupType])),
      markFilteringSet: useMarkFilteringSet ? this.parseUShort() : void 0
    };
  }))) || [];
};
Parser.prototype.parseFeatureVariationsList = function() {
  return this.parsePointer32(function() {
    var majorVersion = this.parseUShort();
    var minorVersion = this.parseUShort();
    check.argument(majorVersion === 1 && minorVersion < 1, "GPOS/GSUB feature variations table unknown.");
    var featureVariations = this.parseRecordList32({
      conditionSetOffset: Parser.offset32,
      featureTableSubstitutionOffset: Parser.offset32
    });
    return featureVariations;
  }) || [];
};
var parse = {
  getByte,
  getCard8: getByte,
  getUShort,
  getCard16: getUShort,
  getShort,
  getULong,
  getFixed,
  getTag,
  getOffset,
  getBytes,
  bytesToString,
  Parser
};
function parseCmapTableFormat12(cmap2, p) {
  p.parseUShort();
  cmap2.length = p.parseULong();
  cmap2.language = p.parseULong();
  var groupCount;
  cmap2.groupCount = groupCount = p.parseULong();
  cmap2.glyphIndexMap = {};
  for (var i = 0; i < groupCount; i += 1) {
    var startCharCode = p.parseULong();
    var endCharCode = p.parseULong();
    var startGlyphId = p.parseULong();
    for (var c = startCharCode; c <= endCharCode; c += 1) {
      cmap2.glyphIndexMap[c] = startGlyphId;
      startGlyphId++;
    }
  }
}
function parseCmapTableFormat4(cmap2, p, data, start, offset) {
  cmap2.length = p.parseUShort();
  cmap2.language = p.parseUShort();
  var segCount;
  cmap2.segCount = segCount = p.parseUShort() >> 1;
  p.skip("uShort", 3);
  cmap2.glyphIndexMap = {};
  var endCountParser = new parse.Parser(data, start + offset + 14);
  var startCountParser = new parse.Parser(data, start + offset + 16 + segCount * 2);
  var idDeltaParser = new parse.Parser(data, start + offset + 16 + segCount * 4);
  var idRangeOffsetParser = new parse.Parser(data, start + offset + 16 + segCount * 6);
  var glyphIndexOffset = start + offset + 16 + segCount * 8;
  for (var i = 0; i < segCount - 1; i += 1) {
    var glyphIndex = void 0;
    var endCount = endCountParser.parseUShort();
    var startCount = startCountParser.parseUShort();
    var idDelta = idDeltaParser.parseShort();
    var idRangeOffset = idRangeOffsetParser.parseUShort();
    for (var c = startCount; c <= endCount; c += 1) {
      if (idRangeOffset !== 0) {
        glyphIndexOffset = idRangeOffsetParser.offset + idRangeOffsetParser.relativeOffset - 2;
        glyphIndexOffset += idRangeOffset;
        glyphIndexOffset += (c - startCount) * 2;
        glyphIndex = parse.getUShort(data, glyphIndexOffset);
        if (glyphIndex !== 0) {
          glyphIndex = glyphIndex + idDelta & 65535;
        }
      } else {
        glyphIndex = c + idDelta & 65535;
      }
      cmap2.glyphIndexMap[c] = glyphIndex;
    }
  }
}
function parseCmapTable(data, start) {
  var cmap2 = {};
  cmap2.version = parse.getUShort(data, start);
  check.argument(cmap2.version === 0, "cmap table version should be 0.");
  cmap2.numTables = parse.getUShort(data, start + 2);
  var offset = -1;
  for (var i = cmap2.numTables - 1; i >= 0; i -= 1) {
    var platformId = parse.getUShort(data, start + 4 + i * 8);
    var encodingId = parse.getUShort(data, start + 4 + i * 8 + 2);
    if (platformId === 3 && (encodingId === 0 || encodingId === 1 || encodingId === 10) || platformId === 0 && (encodingId === 0 || encodingId === 1 || encodingId === 2 || encodingId === 3 || encodingId === 4)) {
      offset = parse.getULong(data, start + 4 + i * 8 + 4);
      break;
    }
  }
  if (offset === -1) {
    throw new Error("No valid cmap sub-tables found.");
  }
  var p = new parse.Parser(data, start + offset);
  cmap2.format = p.parseUShort();
  if (cmap2.format === 12) {
    parseCmapTableFormat12(cmap2, p);
  } else if (cmap2.format === 4) {
    parseCmapTableFormat4(cmap2, p, data, start, offset);
  } else {
    throw new Error("Only format 4 and 12 cmap tables are supported (found format " + cmap2.format + ").");
  }
  return cmap2;
}
function addSegment(t, code, glyphIndex) {
  t.segments.push({
    end: code,
    start: code,
    delta: -(code - glyphIndex),
    offset: 0,
    glyphIndex
  });
}
function addTerminatorSegment(t) {
  t.segments.push({
    end: 65535,
    start: 65535,
    delta: 1,
    offset: 0
  });
}
function makeCmapTable(glyphs) {
  var isPlan0Only = true;
  var i;
  for (i = glyphs.length - 1; i > 0; i -= 1) {
    var g = glyphs.get(i);
    if (g.unicode > 65535) {
      console.log("Adding CMAP format 12 (needed!)");
      isPlan0Only = false;
      break;
    }
  }
  var cmapTable = [
    { name: "version", type: "USHORT", value: 0 },
    { name: "numTables", type: "USHORT", value: isPlan0Only ? 1 : 2 },
    // CMAP 4 header
    { name: "platformID", type: "USHORT", value: 3 },
    { name: "encodingID", type: "USHORT", value: 1 },
    { name: "offset", type: "ULONG", value: isPlan0Only ? 12 : 12 + 8 }
  ];
  if (!isPlan0Only) {
    cmapTable = cmapTable.concat([
      // CMAP 12 header
      { name: "cmap12PlatformID", type: "USHORT", value: 3 },
      // We encode only for PlatformID = 3 (Windows) because it is supported everywhere
      { name: "cmap12EncodingID", type: "USHORT", value: 10 },
      { name: "cmap12Offset", type: "ULONG", value: 0 }
    ]);
  }
  cmapTable = cmapTable.concat([
    // CMAP 4 Subtable
    { name: "format", type: "USHORT", value: 4 },
    { name: "cmap4Length", type: "USHORT", value: 0 },
    { name: "language", type: "USHORT", value: 0 },
    { name: "segCountX2", type: "USHORT", value: 0 },
    { name: "searchRange", type: "USHORT", value: 0 },
    { name: "entrySelector", type: "USHORT", value: 0 },
    { name: "rangeShift", type: "USHORT", value: 0 }
  ]);
  var t = new table.Table("cmap", cmapTable);
  t.segments = [];
  for (i = 0; i < glyphs.length; i += 1) {
    var glyph = glyphs.get(i);
    for (var j = 0; j < glyph.unicodes.length; j += 1) {
      addSegment(t, glyph.unicodes[j], i);
    }
    t.segments = t.segments.sort(function(a, b) {
      return a.start - b.start;
    });
  }
  addTerminatorSegment(t);
  var segCount = t.segments.length;
  var segCountToRemove = 0;
  var endCounts = [];
  var startCounts = [];
  var idDeltas = [];
  var idRangeOffsets = [];
  var glyphIds = [];
  var cmap12Groups = [];
  for (i = 0; i < segCount; i += 1) {
    var segment = t.segments[i];
    if (segment.end <= 65535 && segment.start <= 65535) {
      endCounts = endCounts.concat({ name: "end_" + i, type: "USHORT", value: segment.end });
      startCounts = startCounts.concat({ name: "start_" + i, type: "USHORT", value: segment.start });
      idDeltas = idDeltas.concat({ name: "idDelta_" + i, type: "SHORT", value: segment.delta });
      idRangeOffsets = idRangeOffsets.concat({ name: "idRangeOffset_" + i, type: "USHORT", value: segment.offset });
      if (segment.glyphId !== void 0) {
        glyphIds = glyphIds.concat({ name: "glyph_" + i, type: "USHORT", value: segment.glyphId });
      }
    } else {
      segCountToRemove += 1;
    }
    if (!isPlan0Only && segment.glyphIndex !== void 0) {
      cmap12Groups = cmap12Groups.concat({ name: "cmap12Start_" + i, type: "ULONG", value: segment.start });
      cmap12Groups = cmap12Groups.concat({ name: "cmap12End_" + i, type: "ULONG", value: segment.end });
      cmap12Groups = cmap12Groups.concat({ name: "cmap12Glyph_" + i, type: "ULONG", value: segment.glyphIndex });
    }
  }
  t.segCountX2 = (segCount - segCountToRemove) * 2;
  t.searchRange = Math.pow(2, Math.floor(Math.log(segCount - segCountToRemove) / Math.log(2))) * 2;
  t.entrySelector = Math.log(t.searchRange / 2) / Math.log(2);
  t.rangeShift = t.segCountX2 - t.searchRange;
  t.fields = t.fields.concat(endCounts);
  t.fields.push({ name: "reservedPad", type: "USHORT", value: 0 });
  t.fields = t.fields.concat(startCounts);
  t.fields = t.fields.concat(idDeltas);
  t.fields = t.fields.concat(idRangeOffsets);
  t.fields = t.fields.concat(glyphIds);
  t.cmap4Length = 14 + // Subtable header
  endCounts.length * 2 + 2 + // reservedPad
  startCounts.length * 2 + idDeltas.length * 2 + idRangeOffsets.length * 2 + glyphIds.length * 2;
  if (!isPlan0Only) {
    var cmap12Length = 16 + // Subtable header
    cmap12Groups.length * 4;
    t.cmap12Offset = 12 + 2 * 2 + 4 + t.cmap4Length;
    t.fields = t.fields.concat([
      { name: "cmap12Format", type: "USHORT", value: 12 },
      { name: "cmap12Reserved", type: "USHORT", value: 0 },
      { name: "cmap12Length", type: "ULONG", value: cmap12Length },
      { name: "cmap12Language", type: "ULONG", value: 0 },
      { name: "cmap12nGroups", type: "ULONG", value: cmap12Groups.length / 3 }
    ]);
    t.fields = t.fields.concat(cmap12Groups);
  }
  return t;
}
var cmap = { parse: parseCmapTable, make: makeCmapTable };
var cffStandardStrings = [
  ".notdef",
  "space",
  "exclam",
  "quotedbl",
  "numbersign",
  "dollar",
  "percent",
  "ampersand",
  "quoteright",
  "parenleft",
  "parenright",
  "asterisk",
  "plus",
  "comma",
  "hyphen",
  "period",
  "slash",
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "colon",
  "semicolon",
  "less",
  "equal",
  "greater",
  "question",
  "at",
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "U",
  "V",
  "W",
  "X",
  "Y",
  "Z",
  "bracketleft",
  "backslash",
  "bracketright",
  "asciicircum",
  "underscore",
  "quoteleft",
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
  "g",
  "h",
  "i",
  "j",
  "k",
  "l",
  "m",
  "n",
  "o",
  "p",
  "q",
  "r",
  "s",
  "t",
  "u",
  "v",
  "w",
  "x",
  "y",
  "z",
  "braceleft",
  "bar",
  "braceright",
  "asciitilde",
  "exclamdown",
  "cent",
  "sterling",
  "fraction",
  "yen",
  "florin",
  "section",
  "currency",
  "quotesingle",
  "quotedblleft",
  "guillemotleft",
  "guilsinglleft",
  "guilsinglright",
  "fi",
  "fl",
  "endash",
  "dagger",
  "daggerdbl",
  "periodcentered",
  "paragraph",
  "bullet",
  "quotesinglbase",
  "quotedblbase",
  "quotedblright",
  "guillemotright",
  "ellipsis",
  "perthousand",
  "questiondown",
  "grave",
  "acute",
  "circumflex",
  "tilde",
  "macron",
  "breve",
  "dotaccent",
  "dieresis",
  "ring",
  "cedilla",
  "hungarumlaut",
  "ogonek",
  "caron",
  "emdash",
  "AE",
  "ordfeminine",
  "Lslash",
  "Oslash",
  "OE",
  "ordmasculine",
  "ae",
  "dotlessi",
  "lslash",
  "oslash",
  "oe",
  "germandbls",
  "onesuperior",
  "logicalnot",
  "mu",
  "trademark",
  "Eth",
  "onehalf",
  "plusminus",
  "Thorn",
  "onequarter",
  "divide",
  "brokenbar",
  "degree",
  "thorn",
  "threequarters",
  "twosuperior",
  "registered",
  "minus",
  "eth",
  "multiply",
  "threesuperior",
  "copyright",
  "Aacute",
  "Acircumflex",
  "Adieresis",
  "Agrave",
  "Aring",
  "Atilde",
  "Ccedilla",
  "Eacute",
  "Ecircumflex",
  "Edieresis",
  "Egrave",
  "Iacute",
  "Icircumflex",
  "Idieresis",
  "Igrave",
  "Ntilde",
  "Oacute",
  "Ocircumflex",
  "Odieresis",
  "Ograve",
  "Otilde",
  "Scaron",
  "Uacute",
  "Ucircumflex",
  "Udieresis",
  "Ugrave",
  "Yacute",
  "Ydieresis",
  "Zcaron",
  "aacute",
  "acircumflex",
  "adieresis",
  "agrave",
  "aring",
  "atilde",
  "ccedilla",
  "eacute",
  "ecircumflex",
  "edieresis",
  "egrave",
  "iacute",
  "icircumflex",
  "idieresis",
  "igrave",
  "ntilde",
  "oacute",
  "ocircumflex",
  "odieresis",
  "ograve",
  "otilde",
  "scaron",
  "uacute",
  "ucircumflex",
  "udieresis",
  "ugrave",
  "yacute",
  "ydieresis",
  "zcaron",
  "exclamsmall",
  "Hungarumlautsmall",
  "dollaroldstyle",
  "dollarsuperior",
  "ampersandsmall",
  "Acutesmall",
  "parenleftsuperior",
  "parenrightsuperior",
  "266 ff",
  "onedotenleader",
  "zerooldstyle",
  "oneoldstyle",
  "twooldstyle",
  "threeoldstyle",
  "fouroldstyle",
  "fiveoldstyle",
  "sixoldstyle",
  "sevenoldstyle",
  "eightoldstyle",
  "nineoldstyle",
  "commasuperior",
  "threequartersemdash",
  "periodsuperior",
  "questionsmall",
  "asuperior",
  "bsuperior",
  "centsuperior",
  "dsuperior",
  "esuperior",
  "isuperior",
  "lsuperior",
  "msuperior",
  "nsuperior",
  "osuperior",
  "rsuperior",
  "ssuperior",
  "tsuperior",
  "ff",
  "ffi",
  "ffl",
  "parenleftinferior",
  "parenrightinferior",
  "Circumflexsmall",
  "hyphensuperior",
  "Gravesmall",
  "Asmall",
  "Bsmall",
  "Csmall",
  "Dsmall",
  "Esmall",
  "Fsmall",
  "Gsmall",
  "Hsmall",
  "Ismall",
  "Jsmall",
  "Ksmall",
  "Lsmall",
  "Msmall",
  "Nsmall",
  "Osmall",
  "Psmall",
  "Qsmall",
  "Rsmall",
  "Ssmall",
  "Tsmall",
  "Usmall",
  "Vsmall",
  "Wsmall",
  "Xsmall",
  "Ysmall",
  "Zsmall",
  "colonmonetary",
  "onefitted",
  "rupiah",
  "Tildesmall",
  "exclamdownsmall",
  "centoldstyle",
  "Lslashsmall",
  "Scaronsmall",
  "Zcaronsmall",
  "Dieresissmall",
  "Brevesmall",
  "Caronsmall",
  "Dotaccentsmall",
  "Macronsmall",
  "figuredash",
  "hypheninferior",
  "Ogoneksmall",
  "Ringsmall",
  "Cedillasmall",
  "questiondownsmall",
  "oneeighth",
  "threeeighths",
  "fiveeighths",
  "seveneighths",
  "onethird",
  "twothirds",
  "zerosuperior",
  "foursuperior",
  "fivesuperior",
  "sixsuperior",
  "sevensuperior",
  "eightsuperior",
  "ninesuperior",
  "zeroinferior",
  "oneinferior",
  "twoinferior",
  "threeinferior",
  "fourinferior",
  "fiveinferior",
  "sixinferior",
  "seveninferior",
  "eightinferior",
  "nineinferior",
  "centinferior",
  "dollarinferior",
  "periodinferior",
  "commainferior",
  "Agravesmall",
  "Aacutesmall",
  "Acircumflexsmall",
  "Atildesmall",
  "Adieresissmall",
  "Aringsmall",
  "AEsmall",
  "Ccedillasmall",
  "Egravesmall",
  "Eacutesmall",
  "Ecircumflexsmall",
  "Edieresissmall",
  "Igravesmall",
  "Iacutesmall",
  "Icircumflexsmall",
  "Idieresissmall",
  "Ethsmall",
  "Ntildesmall",
  "Ogravesmall",
  "Oacutesmall",
  "Ocircumflexsmall",
  "Otildesmall",
  "Odieresissmall",
  "OEsmall",
  "Oslashsmall",
  "Ugravesmall",
  "Uacutesmall",
  "Ucircumflexsmall",
  "Udieresissmall",
  "Yacutesmall",
  "Thornsmall",
  "Ydieresissmall",
  "001.000",
  "001.001",
  "001.002",
  "001.003",
  "Black",
  "Bold",
  "Book",
  "Light",
  "Medium",
  "Regular",
  "Roman",
  "Semibold"
];
var cffStandardEncoding = [
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "space",
  "exclam",
  "quotedbl",
  "numbersign",
  "dollar",
  "percent",
  "ampersand",
  "quoteright",
  "parenleft",
  "parenright",
  "asterisk",
  "plus",
  "comma",
  "hyphen",
  "period",
  "slash",
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "colon",
  "semicolon",
  "less",
  "equal",
  "greater",
  "question",
  "at",
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "U",
  "V",
  "W",
  "X",
  "Y",
  "Z",
  "bracketleft",
  "backslash",
  "bracketright",
  "asciicircum",
  "underscore",
  "quoteleft",
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
  "g",
  "h",
  "i",
  "j",
  "k",
  "l",
  "m",
  "n",
  "o",
  "p",
  "q",
  "r",
  "s",
  "t",
  "u",
  "v",
  "w",
  "x",
  "y",
  "z",
  "braceleft",
  "bar",
  "braceright",
  "asciitilde",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "exclamdown",
  "cent",
  "sterling",
  "fraction",
  "yen",
  "florin",
  "section",
  "currency",
  "quotesingle",
  "quotedblleft",
  "guillemotleft",
  "guilsinglleft",
  "guilsinglright",
  "fi",
  "fl",
  "",
  "endash",
  "dagger",
  "daggerdbl",
  "periodcentered",
  "",
  "paragraph",
  "bullet",
  "quotesinglbase",
  "quotedblbase",
  "quotedblright",
  "guillemotright",
  "ellipsis",
  "perthousand",
  "",
  "questiondown",
  "",
  "grave",
  "acute",
  "circumflex",
  "tilde",
  "macron",
  "breve",
  "dotaccent",
  "dieresis",
  "",
  "ring",
  "cedilla",
  "",
  "hungarumlaut",
  "ogonek",
  "caron",
  "emdash",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "AE",
  "",
  "ordfeminine",
  "",
  "",
  "",
  "",
  "Lslash",
  "Oslash",
  "OE",
  "ordmasculine",
  "",
  "",
  "",
  "",
  "",
  "ae",
  "",
  "",
  "",
  "dotlessi",
  "",
  "",
  "lslash",
  "oslash",
  "oe",
  "germandbls"
];
var cffExpertEncoding = [
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "space",
  "exclamsmall",
  "Hungarumlautsmall",
  "",
  "dollaroldstyle",
  "dollarsuperior",
  "ampersandsmall",
  "Acutesmall",
  "parenleftsuperior",
  "parenrightsuperior",
  "twodotenleader",
  "onedotenleader",
  "comma",
  "hyphen",
  "period",
  "fraction",
  "zerooldstyle",
  "oneoldstyle",
  "twooldstyle",
  "threeoldstyle",
  "fouroldstyle",
  "fiveoldstyle",
  "sixoldstyle",
  "sevenoldstyle",
  "eightoldstyle",
  "nineoldstyle",
  "colon",
  "semicolon",
  "commasuperior",
  "threequartersemdash",
  "periodsuperior",
  "questionsmall",
  "",
  "asuperior",
  "bsuperior",
  "centsuperior",
  "dsuperior",
  "esuperior",
  "",
  "",
  "isuperior",
  "",
  "",
  "lsuperior",
  "msuperior",
  "nsuperior",
  "osuperior",
  "",
  "",
  "rsuperior",
  "ssuperior",
  "tsuperior",
  "",
  "ff",
  "fi",
  "fl",
  "ffi",
  "ffl",
  "parenleftinferior",
  "",
  "parenrightinferior",
  "Circumflexsmall",
  "hyphensuperior",
  "Gravesmall",
  "Asmall",
  "Bsmall",
  "Csmall",
  "Dsmall",
  "Esmall",
  "Fsmall",
  "Gsmall",
  "Hsmall",
  "Ismall",
  "Jsmall",
  "Ksmall",
  "Lsmall",
  "Msmall",
  "Nsmall",
  "Osmall",
  "Psmall",
  "Qsmall",
  "Rsmall",
  "Ssmall",
  "Tsmall",
  "Usmall",
  "Vsmall",
  "Wsmall",
  "Xsmall",
  "Ysmall",
  "Zsmall",
  "colonmonetary",
  "onefitted",
  "rupiah",
  "Tildesmall",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "exclamdownsmall",
  "centoldstyle",
  "Lslashsmall",
  "",
  "",
  "Scaronsmall",
  "Zcaronsmall",
  "Dieresissmall",
  "Brevesmall",
  "Caronsmall",
  "",
  "Dotaccentsmall",
  "",
  "",
  "Macronsmall",
  "",
  "",
  "figuredash",
  "hypheninferior",
  "",
  "",
  "Ogoneksmall",
  "Ringsmall",
  "Cedillasmall",
  "",
  "",
  "",
  "onequarter",
  "onehalf",
  "threequarters",
  "questiondownsmall",
  "oneeighth",
  "threeeighths",
  "fiveeighths",
  "seveneighths",
  "onethird",
  "twothirds",
  "",
  "",
  "zerosuperior",
  "onesuperior",
  "twosuperior",
  "threesuperior",
  "foursuperior",
  "fivesuperior",
  "sixsuperior",
  "sevensuperior",
  "eightsuperior",
  "ninesuperior",
  "zeroinferior",
  "oneinferior",
  "twoinferior",
  "threeinferior",
  "fourinferior",
  "fiveinferior",
  "sixinferior",
  "seveninferior",
  "eightinferior",
  "nineinferior",
  "centinferior",
  "dollarinferior",
  "periodinferior",
  "commainferior",
  "Agravesmall",
  "Aacutesmall",
  "Acircumflexsmall",
  "Atildesmall",
  "Adieresissmall",
  "Aringsmall",
  "AEsmall",
  "Ccedillasmall",
  "Egravesmall",
  "Eacutesmall",
  "Ecircumflexsmall",
  "Edieresissmall",
  "Igravesmall",
  "Iacutesmall",
  "Icircumflexsmall",
  "Idieresissmall",
  "Ethsmall",
  "Ntildesmall",
  "Ogravesmall",
  "Oacutesmall",
  "Ocircumflexsmall",
  "Otildesmall",
  "Odieresissmall",
  "OEsmall",
  "Oslashsmall",
  "Ugravesmall",
  "Uacutesmall",
  "Ucircumflexsmall",
  "Udieresissmall",
  "Yacutesmall",
  "Thornsmall",
  "Ydieresissmall"
];
var standardNames = [
  ".notdef",
  ".null",
  "nonmarkingreturn",
  "space",
  "exclam",
  "quotedbl",
  "numbersign",
  "dollar",
  "percent",
  "ampersand",
  "quotesingle",
  "parenleft",
  "parenright",
  "asterisk",
  "plus",
  "comma",
  "hyphen",
  "period",
  "slash",
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "colon",
  "semicolon",
  "less",
  "equal",
  "greater",
  "question",
  "at",
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "U",
  "V",
  "W",
  "X",
  "Y",
  "Z",
  "bracketleft",
  "backslash",
  "bracketright",
  "asciicircum",
  "underscore",
  "grave",
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
  "g",
  "h",
  "i",
  "j",
  "k",
  "l",
  "m",
  "n",
  "o",
  "p",
  "q",
  "r",
  "s",
  "t",
  "u",
  "v",
  "w",
  "x",
  "y",
  "z",
  "braceleft",
  "bar",
  "braceright",
  "asciitilde",
  "Adieresis",
  "Aring",
  "Ccedilla",
  "Eacute",
  "Ntilde",
  "Odieresis",
  "Udieresis",
  "aacute",
  "agrave",
  "acircumflex",
  "adieresis",
  "atilde",
  "aring",
  "ccedilla",
  "eacute",
  "egrave",
  "ecircumflex",
  "edieresis",
  "iacute",
  "igrave",
  "icircumflex",
  "idieresis",
  "ntilde",
  "oacute",
  "ograve",
  "ocircumflex",
  "odieresis",
  "otilde",
  "uacute",
  "ugrave",
  "ucircumflex",
  "udieresis",
  "dagger",
  "degree",
  "cent",
  "sterling",
  "section",
  "bullet",
  "paragraph",
  "germandbls",
  "registered",
  "copyright",
  "trademark",
  "acute",
  "dieresis",
  "notequal",
  "AE",
  "Oslash",
  "infinity",
  "plusminus",
  "lessequal",
  "greaterequal",
  "yen",
  "mu",
  "partialdiff",
  "summation",
  "product",
  "pi",
  "integral",
  "ordfeminine",
  "ordmasculine",
  "Omega",
  "ae",
  "oslash",
  "questiondown",
  "exclamdown",
  "logicalnot",
  "radical",
  "florin",
  "approxequal",
  "Delta",
  "guillemotleft",
  "guillemotright",
  "ellipsis",
  "nonbreakingspace",
  "Agrave",
  "Atilde",
  "Otilde",
  "OE",
  "oe",
  "endash",
  "emdash",
  "quotedblleft",
  "quotedblright",
  "quoteleft",
  "quoteright",
  "divide",
  "lozenge",
  "ydieresis",
  "Ydieresis",
  "fraction",
  "currency",
  "guilsinglleft",
  "guilsinglright",
  "fi",
  "fl",
  "daggerdbl",
  "periodcentered",
  "quotesinglbase",
  "quotedblbase",
  "perthousand",
  "Acircumflex",
  "Ecircumflex",
  "Aacute",
  "Edieresis",
  "Egrave",
  "Iacute",
  "Icircumflex",
  "Idieresis",
  "Igrave",
  "Oacute",
  "Ocircumflex",
  "apple",
  "Ograve",
  "Uacute",
  "Ucircumflex",
  "Ugrave",
  "dotlessi",
  "circumflex",
  "tilde",
  "macron",
  "breve",
  "dotaccent",
  "ring",
  "cedilla",
  "hungarumlaut",
  "ogonek",
  "caron",
  "Lslash",
  "lslash",
  "Scaron",
  "scaron",
  "Zcaron",
  "zcaron",
  "brokenbar",
  "Eth",
  "eth",
  "Yacute",
  "yacute",
  "Thorn",
  "thorn",
  "minus",
  "multiply",
  "onesuperior",
  "twosuperior",
  "threesuperior",
  "onehalf",
  "onequarter",
  "threequarters",
  "franc",
  "Gbreve",
  "gbreve",
  "Idotaccent",
  "Scedilla",
  "scedilla",
  "Cacute",
  "cacute",
  "Ccaron",
  "ccaron",
  "dcroat"
];
function DefaultEncoding(font) {
  this.font = font;
}
DefaultEncoding.prototype.charToGlyphIndex = function(c) {
  var code = c.codePointAt(0);
  var glyphs = this.font.glyphs;
  if (glyphs) {
    for (var i = 0; i < glyphs.length; i += 1) {
      var glyph = glyphs.get(i);
      for (var j = 0; j < glyph.unicodes.length; j += 1) {
        if (glyph.unicodes[j] === code) {
          return i;
        }
      }
    }
  }
  return null;
};
function CmapEncoding(cmap2) {
  this.cmap = cmap2;
}
CmapEncoding.prototype.charToGlyphIndex = function(c) {
  return this.cmap.glyphIndexMap[c.codePointAt(0)] || 0;
};
function CffEncoding(encoding, charset) {
  this.encoding = encoding;
  this.charset = charset;
}
CffEncoding.prototype.charToGlyphIndex = function(s) {
  var code = s.codePointAt(0);
  var charName = this.encoding[code];
  return this.charset.indexOf(charName);
};
function GlyphNames(post2) {
  switch (post2.version) {
    case 1:
      this.names = standardNames.slice();
      break;
    case 2:
      this.names = new Array(post2.numberOfGlyphs);
      for (var i = 0; i < post2.numberOfGlyphs; i++) {
        if (post2.glyphNameIndex[i] < standardNames.length) {
          this.names[i] = standardNames[post2.glyphNameIndex[i]];
        } else {
          this.names[i] = post2.names[post2.glyphNameIndex[i] - standardNames.length];
        }
      }
      break;
    case 2.5:
      this.names = new Array(post2.numberOfGlyphs);
      for (var i$1 = 0; i$1 < post2.numberOfGlyphs; i$1++) {
        this.names[i$1] = standardNames[i$1 + post2.glyphNameIndex[i$1]];
      }
      break;
    case 3:
      this.names = [];
      break;
    default:
      this.names = [];
      break;
  }
}
GlyphNames.prototype.nameToGlyphIndex = function(name) {
  return this.names.indexOf(name);
};
GlyphNames.prototype.glyphIndexToName = function(gid) {
  return this.names[gid];
};
function addGlyphNamesAll(font) {
  var glyph;
  var glyphIndexMap = font.tables.cmap.glyphIndexMap;
  var charCodes = Object.keys(glyphIndexMap);
  for (var i = 0; i < charCodes.length; i += 1) {
    var c = charCodes[i];
    var glyphIndex = glyphIndexMap[c];
    glyph = font.glyphs.get(glyphIndex);
    glyph.addUnicode(parseInt(c));
  }
  for (var i$1 = 0; i$1 < font.glyphs.length; i$1 += 1) {
    glyph = font.glyphs.get(i$1);
    if (font.cffEncoding) {
      if (font.isCIDFont) {
        glyph.name = "gid" + i$1;
      } else {
        glyph.name = font.cffEncoding.charset[i$1];
      }
    } else if (font.glyphNames.names) {
      glyph.name = font.glyphNames.glyphIndexToName(i$1);
    }
  }
}
function addGlyphNamesToUnicodeMap(font) {
  font._IndexToUnicodeMap = {};
  var glyphIndexMap = font.tables.cmap.glyphIndexMap;
  var charCodes = Object.keys(glyphIndexMap);
  for (var i = 0; i < charCodes.length; i += 1) {
    var c = charCodes[i];
    var glyphIndex = glyphIndexMap[c];
    if (font._IndexToUnicodeMap[glyphIndex] === void 0) {
      font._IndexToUnicodeMap[glyphIndex] = {
        unicodes: [parseInt(c)]
      };
    } else {
      font._IndexToUnicodeMap[glyphIndex].unicodes.push(parseInt(c));
    }
  }
}
function addGlyphNames(font, opt) {
  if (opt.lowMemory) {
    addGlyphNamesToUnicodeMap(font);
  } else {
    addGlyphNamesAll(font);
  }
}
function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}
var draw = { line };
function getPathDefinition(glyph, path) {
  var _path = path || new Path();
  return {
    configurable: true,
    get: function() {
      if (typeof _path === "function") {
        _path = _path();
      }
      return _path;
    },
    set: function(p) {
      _path = p;
    }
  };
}
function Glyph(options) {
  this.bindConstructorValues(options);
}
Glyph.prototype.bindConstructorValues = function(options) {
  this.index = options.index || 0;
  this.name = options.name || null;
  this.unicode = options.unicode || void 0;
  this.unicodes = options.unicodes || options.unicode !== void 0 ? [options.unicode] : [];
  if ("xMin" in options) {
    this.xMin = options.xMin;
  }
  if ("yMin" in options) {
    this.yMin = options.yMin;
  }
  if ("xMax" in options) {
    this.xMax = options.xMax;
  }
  if ("yMax" in options) {
    this.yMax = options.yMax;
  }
  if ("advanceWidth" in options) {
    this.advanceWidth = options.advanceWidth;
  }
  Object.defineProperty(this, "path", getPathDefinition(this, options.path));
};
Glyph.prototype.addUnicode = function(unicode) {
  if (this.unicodes.length === 0) {
    this.unicode = unicode;
  }
  this.unicodes.push(unicode);
};
Glyph.prototype.getBoundingBox = function() {
  return this.path.getBoundingBox();
};
Glyph.prototype.getPath = function(x, y, fontSize, options, font) {
  x = x !== void 0 ? x : 0;
  y = y !== void 0 ? y : 0;
  fontSize = fontSize !== void 0 ? fontSize : 72;
  var commands;
  var hPoints;
  if (!options) {
    options = {};
  }
  var xScale = options.xScale;
  var yScale = options.yScale;
  if (options.hinting && font && font.hinting) {
    hPoints = this.path && font.hinting.exec(this, fontSize);
  }
  if (hPoints) {
    commands = font.hinting.getCommands(hPoints);
    x = Math.round(x);
    y = Math.round(y);
    xScale = yScale = 1;
  } else {
    commands = this.path.commands;
    var scale = 1 / (this.path.unitsPerEm || 1e3) * fontSize;
    if (xScale === void 0) {
      xScale = scale;
    }
    if (yScale === void 0) {
      yScale = scale;
    }
  }
  var p = new Path();
  for (var i = 0; i < commands.length; i += 1) {
    var cmd = commands[i];
    if (cmd.type === "M") {
      p.moveTo(x + cmd.x * xScale, y + -cmd.y * yScale);
    } else if (cmd.type === "L") {
      p.lineTo(x + cmd.x * xScale, y + -cmd.y * yScale);
    } else if (cmd.type === "Q") {
      p.quadraticCurveTo(
        x + cmd.x1 * xScale,
        y + -cmd.y1 * yScale,
        x + cmd.x * xScale,
        y + -cmd.y * yScale
      );
    } else if (cmd.type === "C") {
      p.curveTo(
        x + cmd.x1 * xScale,
        y + -cmd.y1 * yScale,
        x + cmd.x2 * xScale,
        y + -cmd.y2 * yScale,
        x + cmd.x * xScale,
        y + -cmd.y * yScale
      );
    } else if (cmd.type === "Z") {
      p.closePath();
    }
  }
  return p;
};
Glyph.prototype.getContours = function() {
  if (this.points === void 0) {
    return [];
  }
  var contours = [];
  var currentContour = [];
  for (var i = 0; i < this.points.length; i += 1) {
    var pt = this.points[i];
    currentContour.push(pt);
    if (pt.lastPointOfContour) {
      contours.push(currentContour);
      currentContour = [];
    }
  }
  check.argument(currentContour.length === 0, "There are still points left in the current contour.");
  return contours;
};
Glyph.prototype.getMetrics = function() {
  var commands = this.path.commands;
  var xCoords = [];
  var yCoords = [];
  for (var i = 0; i < commands.length; i += 1) {
    var cmd = commands[i];
    if (cmd.type !== "Z") {
      xCoords.push(cmd.x);
      yCoords.push(cmd.y);
    }
    if (cmd.type === "Q" || cmd.type === "C") {
      xCoords.push(cmd.x1);
      yCoords.push(cmd.y1);
    }
    if (cmd.type === "C") {
      xCoords.push(cmd.x2);
      yCoords.push(cmd.y2);
    }
  }
  var metrics = {
    xMin: Math.min.apply(null, xCoords),
    yMin: Math.min.apply(null, yCoords),
    xMax: Math.max.apply(null, xCoords),
    yMax: Math.max.apply(null, yCoords),
    leftSideBearing: this.leftSideBearing
  };
  if (!isFinite(metrics.xMin)) {
    metrics.xMin = 0;
  }
  if (!isFinite(metrics.xMax)) {
    metrics.xMax = this.advanceWidth;
  }
  if (!isFinite(metrics.yMin)) {
    metrics.yMin = 0;
  }
  if (!isFinite(metrics.yMax)) {
    metrics.yMax = 0;
  }
  metrics.rightSideBearing = this.advanceWidth - metrics.leftSideBearing - (metrics.xMax - metrics.xMin);
  return metrics;
};
Glyph.prototype.draw = function(ctx, x, y, fontSize, options) {
  this.getPath(x, y, fontSize, options).draw(ctx);
};
Glyph.prototype.drawPoints = function(ctx, x, y, fontSize) {
  function drawCircles(l, x2, y2, scale2) {
    ctx.beginPath();
    for (var j = 0; j < l.length; j += 1) {
      ctx.moveTo(x2 + l[j].x * scale2, y2 + l[j].y * scale2);
      ctx.arc(x2 + l[j].x * scale2, y2 + l[j].y * scale2, 2, 0, Math.PI * 2, false);
    }
    ctx.closePath();
    ctx.fill();
  }
  x = x !== void 0 ? x : 0;
  y = y !== void 0 ? y : 0;
  fontSize = fontSize !== void 0 ? fontSize : 24;
  var scale = 1 / this.path.unitsPerEm * fontSize;
  var blueCircles = [];
  var redCircles = [];
  var path = this.path;
  for (var i = 0; i < path.commands.length; i += 1) {
    var cmd = path.commands[i];
    if (cmd.x !== void 0) {
      blueCircles.push({ x: cmd.x, y: -cmd.y });
    }
    if (cmd.x1 !== void 0) {
      redCircles.push({ x: cmd.x1, y: -cmd.y1 });
    }
    if (cmd.x2 !== void 0) {
      redCircles.push({ x: cmd.x2, y: -cmd.y2 });
    }
  }
  ctx.fillStyle = "blue";
  drawCircles(blueCircles, x, y, scale);
  ctx.fillStyle = "red";
  drawCircles(redCircles, x, y, scale);
};
Glyph.prototype.drawMetrics = function(ctx, x, y, fontSize) {
  var scale;
  x = x !== void 0 ? x : 0;
  y = y !== void 0 ? y : 0;
  fontSize = fontSize !== void 0 ? fontSize : 24;
  scale = 1 / this.path.unitsPerEm * fontSize;
  ctx.lineWidth = 1;
  ctx.strokeStyle = "black";
  draw.line(ctx, x, -1e4, x, 1e4);
  draw.line(ctx, -1e4, y, 1e4, y);
  var xMin = this.xMin || 0;
  var yMin = this.yMin || 0;
  var xMax = this.xMax || 0;
  var yMax = this.yMax || 0;
  var advanceWidth = this.advanceWidth || 0;
  ctx.strokeStyle = "blue";
  draw.line(ctx, x + xMin * scale, -1e4, x + xMin * scale, 1e4);
  draw.line(ctx, x + xMax * scale, -1e4, x + xMax * scale, 1e4);
  draw.line(ctx, -1e4, y + -yMin * scale, 1e4, y + -yMin * scale);
  draw.line(ctx, -1e4, y + -yMax * scale, 1e4, y + -yMax * scale);
  ctx.strokeStyle = "green";
  draw.line(ctx, x + advanceWidth * scale, -1e4, x + advanceWidth * scale, 1e4);
};
function defineDependentProperty(glyph, externalName, internalName) {
  Object.defineProperty(glyph, externalName, {
    get: function() {
      glyph.path;
      return glyph[internalName];
    },
    set: function(newValue) {
      glyph[internalName] = newValue;
    },
    enumerable: true,
    configurable: true
  });
}
function GlyphSet(font, glyphs) {
  this.font = font;
  this.glyphs = {};
  if (Array.isArray(glyphs)) {
    for (var i = 0; i < glyphs.length; i++) {
      var glyph = glyphs[i];
      glyph.path.unitsPerEm = font.unitsPerEm;
      this.glyphs[i] = glyph;
    }
  }
  this.length = glyphs && glyphs.length || 0;
}
GlyphSet.prototype.get = function(index) {
  if (this.glyphs[index] === void 0) {
    this.font._push(index);
    if (typeof this.glyphs[index] === "function") {
      this.glyphs[index] = this.glyphs[index]();
    }
    var glyph = this.glyphs[index];
    var unicodeObj = this.font._IndexToUnicodeMap[index];
    if (unicodeObj) {
      for (var j = 0; j < unicodeObj.unicodes.length; j++) {
        glyph.addUnicode(unicodeObj.unicodes[j]);
      }
    }
    if (this.font.cffEncoding) {
      if (this.font.isCIDFont) {
        glyph.name = "gid" + index;
      } else {
        glyph.name = this.font.cffEncoding.charset[index];
      }
    } else if (this.font.glyphNames.names) {
      glyph.name = this.font.glyphNames.glyphIndexToName(index);
    }
    this.glyphs[index].advanceWidth = this.font._hmtxTableData[index].advanceWidth;
    this.glyphs[index].leftSideBearing = this.font._hmtxTableData[index].leftSideBearing;
  } else {
    if (typeof this.glyphs[index] === "function") {
      this.glyphs[index] = this.glyphs[index]();
    }
  }
  return this.glyphs[index];
};
GlyphSet.prototype.push = function(index, loader) {
  this.glyphs[index] = loader;
  this.length++;
};
function glyphLoader(font, index) {
  return new Glyph({ index, font });
}
function ttfGlyphLoader(font, index, parseGlyph2, data, position, buildPath2) {
  return function() {
    var glyph = new Glyph({ index, font });
    glyph.path = function() {
      parseGlyph2(glyph, data, position);
      var path = buildPath2(font.glyphs, glyph);
      path.unitsPerEm = font.unitsPerEm;
      return path;
    };
    defineDependentProperty(glyph, "xMin", "_xMin");
    defineDependentProperty(glyph, "xMax", "_xMax");
    defineDependentProperty(glyph, "yMin", "_yMin");
    defineDependentProperty(glyph, "yMax", "_yMax");
    return glyph;
  };
}
function cffGlyphLoader(font, index, parseCFFCharstring2, charstring) {
  return function() {
    var glyph = new Glyph({ index, font });
    glyph.path = function() {
      var path = parseCFFCharstring2(font, glyph, charstring);
      path.unitsPerEm = font.unitsPerEm;
      return path;
    };
    return glyph;
  };
}
var glyphset = { GlyphSet, glyphLoader, ttfGlyphLoader, cffGlyphLoader };
function equals(a, b) {
  if (a === b) {
    return true;
  } else if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return false;
    }
    for (var i = 0; i < a.length; i += 1) {
      if (!equals(a[i], b[i])) {
        return false;
      }
    }
    return true;
  } else {
    return false;
  }
}
function calcCFFSubroutineBias(subrs) {
  var bias;
  if (subrs.length < 1240) {
    bias = 107;
  } else if (subrs.length < 33900) {
    bias = 1131;
  } else {
    bias = 32768;
  }
  return bias;
}
function parseCFFIndex(data, start, conversionFn) {
  var offsets = [];
  var objects = [];
  var count = parse.getCard16(data, start);
  var objectOffset;
  var endOffset;
  if (count !== 0) {
    var offsetSize = parse.getByte(data, start + 2);
    objectOffset = start + (count + 1) * offsetSize + 2;
    var pos = start + 3;
    for (var i = 0; i < count + 1; i += 1) {
      offsets.push(parse.getOffset(data, pos, offsetSize));
      pos += offsetSize;
    }
    endOffset = objectOffset + offsets[count];
  } else {
    endOffset = start + 2;
  }
  for (var i$1 = 0; i$1 < offsets.length - 1; i$1 += 1) {
    var value = parse.getBytes(data, objectOffset + offsets[i$1], objectOffset + offsets[i$1 + 1]);
    if (conversionFn) {
      value = conversionFn(value);
    }
    objects.push(value);
  }
  return { objects, startOffset: start, endOffset };
}
function parseCFFIndexLowMemory(data, start) {
  var offsets = [];
  var count = parse.getCard16(data, start);
  var objectOffset;
  var endOffset;
  if (count !== 0) {
    var offsetSize = parse.getByte(data, start + 2);
    objectOffset = start + (count + 1) * offsetSize + 2;
    var pos = start + 3;
    for (var i = 0; i < count + 1; i += 1) {
      offsets.push(parse.getOffset(data, pos, offsetSize));
      pos += offsetSize;
    }
    endOffset = objectOffset + offsets[count];
  } else {
    endOffset = start + 2;
  }
  return { offsets, startOffset: start, endOffset };
}
function getCffIndexObject(i, offsets, data, start, conversionFn) {
  var count = parse.getCard16(data, start);
  var objectOffset = 0;
  if (count !== 0) {
    var offsetSize = parse.getByte(data, start + 2);
    objectOffset = start + (count + 1) * offsetSize + 2;
  }
  var value = parse.getBytes(data, objectOffset + offsets[i], objectOffset + offsets[i + 1]);
  if (conversionFn) {
    value = conversionFn(value);
  }
  return value;
}
function parseFloatOperand(parser) {
  var s = "";
  var eof = 15;
  var lookup = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "E", "E-", null, "-"];
  while (true) {
    var b = parser.parseByte();
    var n1 = b >> 4;
    var n2 = b & 15;
    if (n1 === eof) {
      break;
    }
    s += lookup[n1];
    if (n2 === eof) {
      break;
    }
    s += lookup[n2];
  }
  return parseFloat(s);
}
function parseOperand(parser, b0) {
  var b1;
  var b2;
  var b3;
  var b4;
  if (b0 === 28) {
    b1 = parser.parseByte();
    b2 = parser.parseByte();
    return b1 << 8 | b2;
  }
  if (b0 === 29) {
    b1 = parser.parseByte();
    b2 = parser.parseByte();
    b3 = parser.parseByte();
    b4 = parser.parseByte();
    return b1 << 24 | b2 << 16 | b3 << 8 | b4;
  }
  if (b0 === 30) {
    return parseFloatOperand(parser);
  }
  if (b0 >= 32 && b0 <= 246) {
    return b0 - 139;
  }
  if (b0 >= 247 && b0 <= 250) {
    b1 = parser.parseByte();
    return (b0 - 247) * 256 + b1 + 108;
  }
  if (b0 >= 251 && b0 <= 254) {
    b1 = parser.parseByte();
    return -(b0 - 251) * 256 - b1 - 108;
  }
  throw new Error("Invalid b0 " + b0);
}
function entriesToObject(entries) {
  var o = {};
  for (var i = 0; i < entries.length; i += 1) {
    var key = entries[i][0];
    var values = entries[i][1];
    var value = void 0;
    if (values.length === 1) {
      value = values[0];
    } else {
      value = values;
    }
    if (o.hasOwnProperty(key) && !isNaN(o[key])) {
      throw new Error("Object " + o + " already has key " + key);
    }
    o[key] = value;
  }
  return o;
}
function parseCFFDict(data, start, size) {
  start = start !== void 0 ? start : 0;
  var parser = new parse.Parser(data, start);
  var entries = [];
  var operands = [];
  size = size !== void 0 ? size : data.length;
  while (parser.relativeOffset < size) {
    var op = parser.parseByte();
    if (op <= 21) {
      if (op === 12) {
        op = 1200 + parser.parseByte();
      }
      entries.push([op, operands]);
      operands = [];
    } else {
      operands.push(parseOperand(parser, op));
    }
  }
  return entriesToObject(entries);
}
function getCFFString(strings, index) {
  if (index <= 390) {
    index = cffStandardStrings[index];
  } else {
    index = strings[index - 391];
  }
  return index;
}
function interpretDict(dict, meta2, strings) {
  var newDict = {};
  var value;
  for (var i = 0; i < meta2.length; i += 1) {
    var m = meta2[i];
    if (Array.isArray(m.type)) {
      var values = [];
      values.length = m.type.length;
      for (var j = 0; j < m.type.length; j++) {
        value = dict[m.op] !== void 0 ? dict[m.op][j] : void 0;
        if (value === void 0) {
          value = m.value !== void 0 && m.value[j] !== void 0 ? m.value[j] : null;
        }
        if (m.type[j] === "SID") {
          value = getCFFString(strings, value);
        }
        values[j] = value;
      }
      newDict[m.name] = values;
    } else {
      value = dict[m.op];
      if (value === void 0) {
        value = m.value !== void 0 ? m.value : null;
      }
      if (m.type === "SID") {
        value = getCFFString(strings, value);
      }
      newDict[m.name] = value;
    }
  }
  return newDict;
}
function parseCFFHeader(data, start) {
  var header = {};
  header.formatMajor = parse.getCard8(data, start);
  header.formatMinor = parse.getCard8(data, start + 1);
  header.size = parse.getCard8(data, start + 2);
  header.offsetSize = parse.getCard8(data, start + 3);
  header.startOffset = start;
  header.endOffset = start + 4;
  return header;
}
var TOP_DICT_META = [
  { name: "version", op: 0, type: "SID" },
  { name: "notice", op: 1, type: "SID" },
  { name: "copyright", op: 1200, type: "SID" },
  { name: "fullName", op: 2, type: "SID" },
  { name: "familyName", op: 3, type: "SID" },
  { name: "weight", op: 4, type: "SID" },
  { name: "isFixedPitch", op: 1201, type: "number", value: 0 },
  { name: "italicAngle", op: 1202, type: "number", value: 0 },
  { name: "underlinePosition", op: 1203, type: "number", value: -100 },
  { name: "underlineThickness", op: 1204, type: "number", value: 50 },
  { name: "paintType", op: 1205, type: "number", value: 0 },
  { name: "charstringType", op: 1206, type: "number", value: 2 },
  {
    name: "fontMatrix",
    op: 1207,
    type: ["real", "real", "real", "real", "real", "real"],
    value: [1e-3, 0, 0, 1e-3, 0, 0]
  },
  { name: "uniqueId", op: 13, type: "number" },
  { name: "fontBBox", op: 5, type: ["number", "number", "number", "number"], value: [0, 0, 0, 0] },
  { name: "strokeWidth", op: 1208, type: "number", value: 0 },
  { name: "xuid", op: 14, type: [], value: null },
  { name: "charset", op: 15, type: "offset", value: 0 },
  { name: "encoding", op: 16, type: "offset", value: 0 },
  { name: "charStrings", op: 17, type: "offset", value: 0 },
  { name: "private", op: 18, type: ["number", "offset"], value: [0, 0] },
  { name: "ros", op: 1230, type: ["SID", "SID", "number"] },
  { name: "cidFontVersion", op: 1231, type: "number", value: 0 },
  { name: "cidFontRevision", op: 1232, type: "number", value: 0 },
  { name: "cidFontType", op: 1233, type: "number", value: 0 },
  { name: "cidCount", op: 1234, type: "number", value: 8720 },
  { name: "uidBase", op: 1235, type: "number" },
  { name: "fdArray", op: 1236, type: "offset" },
  { name: "fdSelect", op: 1237, type: "offset" },
  { name: "fontName", op: 1238, type: "SID" }
];
var PRIVATE_DICT_META = [
  { name: "subrs", op: 19, type: "offset", value: 0 },
  { name: "defaultWidthX", op: 20, type: "number", value: 0 },
  { name: "nominalWidthX", op: 21, type: "number", value: 0 }
];
function parseCFFTopDict(data, strings) {
  var dict = parseCFFDict(data, 0, data.byteLength);
  return interpretDict(dict, TOP_DICT_META, strings);
}
function parseCFFPrivateDict(data, start, size, strings) {
  var dict = parseCFFDict(data, start, size);
  return interpretDict(dict, PRIVATE_DICT_META, strings);
}
function gatherCFFTopDicts(data, start, cffIndex, strings) {
  var topDictArray = [];
  for (var iTopDict = 0; iTopDict < cffIndex.length; iTopDict += 1) {
    var topDictData = new DataView(new Uint8Array(cffIndex[iTopDict]).buffer);
    var topDict = parseCFFTopDict(topDictData, strings);
    topDict._subrs = [];
    topDict._subrsBias = 0;
    topDict._defaultWidthX = 0;
    topDict._nominalWidthX = 0;
    var privateSize = topDict.private[0];
    var privateOffset = topDict.private[1];
    if (privateSize !== 0 && privateOffset !== 0) {
      var privateDict = parseCFFPrivateDict(data, privateOffset + start, privateSize, strings);
      topDict._defaultWidthX = privateDict.defaultWidthX;
      topDict._nominalWidthX = privateDict.nominalWidthX;
      if (privateDict.subrs !== 0) {
        var subrOffset = privateOffset + privateDict.subrs;
        var subrIndex = parseCFFIndex(data, subrOffset + start);
        topDict._subrs = subrIndex.objects;
        topDict._subrsBias = calcCFFSubroutineBias(topDict._subrs);
      }
      topDict._privateDict = privateDict;
    }
    topDictArray.push(topDict);
  }
  return topDictArray;
}
function parseCFFCharset(data, start, nGlyphs, strings) {
  var sid;
  var count;
  var parser = new parse.Parser(data, start);
  nGlyphs -= 1;
  var charset = [".notdef"];
  var format = parser.parseCard8();
  if (format === 0) {
    for (var i = 0; i < nGlyphs; i += 1) {
      sid = parser.parseSID();
      charset.push(getCFFString(strings, sid));
    }
  } else if (format === 1) {
    while (charset.length <= nGlyphs) {
      sid = parser.parseSID();
      count = parser.parseCard8();
      for (var i$1 = 0; i$1 <= count; i$1 += 1) {
        charset.push(getCFFString(strings, sid));
        sid += 1;
      }
    }
  } else if (format === 2) {
    while (charset.length <= nGlyphs) {
      sid = parser.parseSID();
      count = parser.parseCard16();
      for (var i$2 = 0; i$2 <= count; i$2 += 1) {
        charset.push(getCFFString(strings, sid));
        sid += 1;
      }
    }
  } else {
    throw new Error("Unknown charset format " + format);
  }
  return charset;
}
function parseCFFEncoding(data, start, charset) {
  var code;
  var enc = {};
  var parser = new parse.Parser(data, start);
  var format = parser.parseCard8();
  if (format === 0) {
    var nCodes = parser.parseCard8();
    for (var i = 0; i < nCodes; i += 1) {
      code = parser.parseCard8();
      enc[code] = i;
    }
  } else if (format === 1) {
    var nRanges = parser.parseCard8();
    code = 1;
    for (var i$1 = 0; i$1 < nRanges; i$1 += 1) {
      var first = parser.parseCard8();
      var nLeft = parser.parseCard8();
      for (var j = first; j <= first + nLeft; j += 1) {
        enc[j] = code;
        code += 1;
      }
    }
  } else {
    throw new Error("Unknown encoding format " + format);
  }
  return new CffEncoding(enc, charset);
}
function parseCFFCharstring(font, glyph, code) {
  var c1x;
  var c1y;
  var c2x;
  var c2y;
  var p = new Path();
  var stack = [];
  var nStems = 0;
  var haveWidth = false;
  var open = false;
  var x = 0;
  var y = 0;
  var subrs;
  var subrsBias;
  var defaultWidthX;
  var nominalWidthX;
  if (font.isCIDFont) {
    var fdIndex = font.tables.cff.topDict._fdSelect[glyph.index];
    var fdDict = font.tables.cff.topDict._fdArray[fdIndex];
    subrs = fdDict._subrs;
    subrsBias = fdDict._subrsBias;
    defaultWidthX = fdDict._defaultWidthX;
    nominalWidthX = fdDict._nominalWidthX;
  } else {
    subrs = font.tables.cff.topDict._subrs;
    subrsBias = font.tables.cff.topDict._subrsBias;
    defaultWidthX = font.tables.cff.topDict._defaultWidthX;
    nominalWidthX = font.tables.cff.topDict._nominalWidthX;
  }
  var width = defaultWidthX;
  function newContour(x2, y2) {
    if (open) {
      p.closePath();
    }
    p.moveTo(x2, y2);
    open = true;
  }
  function parseStems() {
    var hasWidthArg;
    hasWidthArg = stack.length % 2 !== 0;
    if (hasWidthArg && !haveWidth) {
      width = stack.shift() + nominalWidthX;
    }
    nStems += stack.length >> 1;
    stack.length = 0;
    haveWidth = true;
  }
  function parse2(code2) {
    var b1;
    var b2;
    var b3;
    var b4;
    var codeIndex;
    var subrCode;
    var jpx;
    var jpy;
    var c3x;
    var c3y;
    var c4x;
    var c4y;
    var i = 0;
    while (i < code2.length) {
      var v = code2[i];
      i += 1;
      switch (v) {
        case 1:
          parseStems();
          break;
        case 3:
          parseStems();
          break;
        case 4:
          if (stack.length > 1 && !haveWidth) {
            width = stack.shift() + nominalWidthX;
            haveWidth = true;
          }
          y += stack.pop();
          newContour(x, y);
          break;
        case 5:
          while (stack.length > 0) {
            x += stack.shift();
            y += stack.shift();
            p.lineTo(x, y);
          }
          break;
        case 6:
          while (stack.length > 0) {
            x += stack.shift();
            p.lineTo(x, y);
            if (stack.length === 0) {
              break;
            }
            y += stack.shift();
            p.lineTo(x, y);
          }
          break;
        case 7:
          while (stack.length > 0) {
            y += stack.shift();
            p.lineTo(x, y);
            if (stack.length === 0) {
              break;
            }
            x += stack.shift();
            p.lineTo(x, y);
          }
          break;
        case 8:
          while (stack.length > 0) {
            c1x = x + stack.shift();
            c1y = y + stack.shift();
            c2x = c1x + stack.shift();
            c2y = c1y + stack.shift();
            x = c2x + stack.shift();
            y = c2y + stack.shift();
            p.curveTo(c1x, c1y, c2x, c2y, x, y);
          }
          break;
        case 10:
          codeIndex = stack.pop() + subrsBias;
          subrCode = subrs[codeIndex];
          if (subrCode) {
            parse2(subrCode);
          }
          break;
        case 11:
          return;
        case 12:
          v = code2[i];
          i += 1;
          switch (v) {
            case 35:
              c1x = x + stack.shift();
              c1y = y + stack.shift();
              c2x = c1x + stack.shift();
              c2y = c1y + stack.shift();
              jpx = c2x + stack.shift();
              jpy = c2y + stack.shift();
              c3x = jpx + stack.shift();
              c3y = jpy + stack.shift();
              c4x = c3x + stack.shift();
              c4y = c3y + stack.shift();
              x = c4x + stack.shift();
              y = c4y + stack.shift();
              stack.shift();
              p.curveTo(c1x, c1y, c2x, c2y, jpx, jpy);
              p.curveTo(c3x, c3y, c4x, c4y, x, y);
              break;
            case 34:
              c1x = x + stack.shift();
              c1y = y;
              c2x = c1x + stack.shift();
              c2y = c1y + stack.shift();
              jpx = c2x + stack.shift();
              jpy = c2y;
              c3x = jpx + stack.shift();
              c3y = c2y;
              c4x = c3x + stack.shift();
              c4y = y;
              x = c4x + stack.shift();
              p.curveTo(c1x, c1y, c2x, c2y, jpx, jpy);
              p.curveTo(c3x, c3y, c4x, c4y, x, y);
              break;
            case 36:
              c1x = x + stack.shift();
              c1y = y + stack.shift();
              c2x = c1x + stack.shift();
              c2y = c1y + stack.shift();
              jpx = c2x + stack.shift();
              jpy = c2y;
              c3x = jpx + stack.shift();
              c3y = c2y;
              c4x = c3x + stack.shift();
              c4y = c3y + stack.shift();
              x = c4x + stack.shift();
              p.curveTo(c1x, c1y, c2x, c2y, jpx, jpy);
              p.curveTo(c3x, c3y, c4x, c4y, x, y);
              break;
            case 37:
              c1x = x + stack.shift();
              c1y = y + stack.shift();
              c2x = c1x + stack.shift();
              c2y = c1y + stack.shift();
              jpx = c2x + stack.shift();
              jpy = c2y + stack.shift();
              c3x = jpx + stack.shift();
              c3y = jpy + stack.shift();
              c4x = c3x + stack.shift();
              c4y = c3y + stack.shift();
              if (Math.abs(c4x - x) > Math.abs(c4y - y)) {
                x = c4x + stack.shift();
              } else {
                y = c4y + stack.shift();
              }
              p.curveTo(c1x, c1y, c2x, c2y, jpx, jpy);
              p.curveTo(c3x, c3y, c4x, c4y, x, y);
              break;
            default:
              console.log("Glyph " + glyph.index + ": unknown operator 1200" + v);
              stack.length = 0;
          }
          break;
        case 14:
          if (stack.length > 0 && !haveWidth) {
            width = stack.shift() + nominalWidthX;
            haveWidth = true;
          }
          if (open) {
            p.closePath();
            open = false;
          }
          break;
        case 18:
          parseStems();
          break;
        case 19:
        // hintmask
        case 20:
          parseStems();
          i += nStems + 7 >> 3;
          break;
        case 21:
          if (stack.length > 2 && !haveWidth) {
            width = stack.shift() + nominalWidthX;
            haveWidth = true;
          }
          y += stack.pop();
          x += stack.pop();
          newContour(x, y);
          break;
        case 22:
          if (stack.length > 1 && !haveWidth) {
            width = stack.shift() + nominalWidthX;
            haveWidth = true;
          }
          x += stack.pop();
          newContour(x, y);
          break;
        case 23:
          parseStems();
          break;
        case 24:
          while (stack.length > 2) {
            c1x = x + stack.shift();
            c1y = y + stack.shift();
            c2x = c1x + stack.shift();
            c2y = c1y + stack.shift();
            x = c2x + stack.shift();
            y = c2y + stack.shift();
            p.curveTo(c1x, c1y, c2x, c2y, x, y);
          }
          x += stack.shift();
          y += stack.shift();
          p.lineTo(x, y);
          break;
        case 25:
          while (stack.length > 6) {
            x += stack.shift();
            y += stack.shift();
            p.lineTo(x, y);
          }
          c1x = x + stack.shift();
          c1y = y + stack.shift();
          c2x = c1x + stack.shift();
          c2y = c1y + stack.shift();
          x = c2x + stack.shift();
          y = c2y + stack.shift();
          p.curveTo(c1x, c1y, c2x, c2y, x, y);
          break;
        case 26:
          if (stack.length % 2) {
            x += stack.shift();
          }
          while (stack.length > 0) {
            c1x = x;
            c1y = y + stack.shift();
            c2x = c1x + stack.shift();
            c2y = c1y + stack.shift();
            x = c2x;
            y = c2y + stack.shift();
            p.curveTo(c1x, c1y, c2x, c2y, x, y);
          }
          break;
        case 27:
          if (stack.length % 2) {
            y += stack.shift();
          }
          while (stack.length > 0) {
            c1x = x + stack.shift();
            c1y = y;
            c2x = c1x + stack.shift();
            c2y = c1y + stack.shift();
            x = c2x + stack.shift();
            y = c2y;
            p.curveTo(c1x, c1y, c2x, c2y, x, y);
          }
          break;
        case 28:
          b1 = code2[i];
          b2 = code2[i + 1];
          stack.push((b1 << 24 | b2 << 16) >> 16);
          i += 2;
          break;
        case 29:
          codeIndex = stack.pop() + font.gsubrsBias;
          subrCode = font.gsubrs[codeIndex];
          if (subrCode) {
            parse2(subrCode);
          }
          break;
        case 30:
          while (stack.length > 0) {
            c1x = x;
            c1y = y + stack.shift();
            c2x = c1x + stack.shift();
            c2y = c1y + stack.shift();
            x = c2x + stack.shift();
            y = c2y + (stack.length === 1 ? stack.shift() : 0);
            p.curveTo(c1x, c1y, c2x, c2y, x, y);
            if (stack.length === 0) {
              break;
            }
            c1x = x + stack.shift();
            c1y = y;
            c2x = c1x + stack.shift();
            c2y = c1y + stack.shift();
            y = c2y + stack.shift();
            x = c2x + (stack.length === 1 ? stack.shift() : 0);
            p.curveTo(c1x, c1y, c2x, c2y, x, y);
          }
          break;
        case 31:
          while (stack.length > 0) {
            c1x = x + stack.shift();
            c1y = y;
            c2x = c1x + stack.shift();
            c2y = c1y + stack.shift();
            y = c2y + stack.shift();
            x = c2x + (stack.length === 1 ? stack.shift() : 0);
            p.curveTo(c1x, c1y, c2x, c2y, x, y);
            if (stack.length === 0) {
              break;
            }
            c1x = x;
            c1y = y + stack.shift();
            c2x = c1x + stack.shift();
            c2y = c1y + stack.shift();
            x = c2x + stack.shift();
            y = c2y + (stack.length === 1 ? stack.shift() : 0);
            p.curveTo(c1x, c1y, c2x, c2y, x, y);
          }
          break;
        default:
          if (v < 32) {
            console.log("Glyph " + glyph.index + ": unknown operator " + v);
          } else if (v < 247) {
            stack.push(v - 139);
          } else if (v < 251) {
            b1 = code2[i];
            i += 1;
            stack.push((v - 247) * 256 + b1 + 108);
          } else if (v < 255) {
            b1 = code2[i];
            i += 1;
            stack.push(-(v - 251) * 256 - b1 - 108);
          } else {
            b1 = code2[i];
            b2 = code2[i + 1];
            b3 = code2[i + 2];
            b4 = code2[i + 3];
            i += 4;
            stack.push((b1 << 24 | b2 << 16 | b3 << 8 | b4) / 65536);
          }
      }
    }
  }
  parse2(code);
  glyph.advanceWidth = width;
  return p;
}
function parseCFFFDSelect(data, start, nGlyphs, fdArrayCount) {
  var fdSelect = [];
  var fdIndex;
  var parser = new parse.Parser(data, start);
  var format = parser.parseCard8();
  if (format === 0) {
    for (var iGid = 0; iGid < nGlyphs; iGid++) {
      fdIndex = parser.parseCard8();
      if (fdIndex >= fdArrayCount) {
        throw new Error("CFF table CID Font FDSelect has bad FD index value " + fdIndex + " (FD count " + fdArrayCount + ")");
      }
      fdSelect.push(fdIndex);
    }
  } else if (format === 3) {
    var nRanges = parser.parseCard16();
    var first = parser.parseCard16();
    if (first !== 0) {
      throw new Error("CFF Table CID Font FDSelect format 3 range has bad initial GID " + first);
    }
    var next;
    for (var iRange = 0; iRange < nRanges; iRange++) {
      fdIndex = parser.parseCard8();
      next = parser.parseCard16();
      if (fdIndex >= fdArrayCount) {
        throw new Error("CFF table CID Font FDSelect has bad FD index value " + fdIndex + " (FD count " + fdArrayCount + ")");
      }
      if (next > nGlyphs) {
        throw new Error("CFF Table CID Font FDSelect format 3 range has bad GID " + next);
      }
      for (; first < next; first++) {
        fdSelect.push(fdIndex);
      }
      first = next;
    }
    if (next !== nGlyphs) {
      throw new Error("CFF Table CID Font FDSelect format 3 range has bad final GID " + next);
    }
  } else {
    throw new Error("CFF Table CID Font FDSelect table has unsupported format " + format);
  }
  return fdSelect;
}
function parseCFFTable(data, start, font, opt) {
  font.tables.cff = {};
  var header = parseCFFHeader(data, start);
  var nameIndex = parseCFFIndex(data, header.endOffset, parse.bytesToString);
  var topDictIndex = parseCFFIndex(data, nameIndex.endOffset);
  var stringIndex = parseCFFIndex(data, topDictIndex.endOffset, parse.bytesToString);
  var globalSubrIndex = parseCFFIndex(data, stringIndex.endOffset);
  font.gsubrs = globalSubrIndex.objects;
  font.gsubrsBias = calcCFFSubroutineBias(font.gsubrs);
  var topDictArray = gatherCFFTopDicts(data, start, topDictIndex.objects, stringIndex.objects);
  if (topDictArray.length !== 1) {
    throw new Error("CFF table has too many fonts in 'FontSet' - count of fonts NameIndex.length = " + topDictArray.length);
  }
  var topDict = topDictArray[0];
  font.tables.cff.topDict = topDict;
  if (topDict._privateDict) {
    font.defaultWidthX = topDict._privateDict.defaultWidthX;
    font.nominalWidthX = topDict._privateDict.nominalWidthX;
  }
  if (topDict.ros[0] !== void 0 && topDict.ros[1] !== void 0) {
    font.isCIDFont = true;
  }
  if (font.isCIDFont) {
    var fdArrayOffset = topDict.fdArray;
    var fdSelectOffset = topDict.fdSelect;
    if (fdArrayOffset === 0 || fdSelectOffset === 0) {
      throw new Error("Font is marked as a CID font, but FDArray and/or FDSelect information is missing");
    }
    fdArrayOffset += start;
    var fdArrayIndex = parseCFFIndex(data, fdArrayOffset);
    var fdArray = gatherCFFTopDicts(data, start, fdArrayIndex.objects, stringIndex.objects);
    topDict._fdArray = fdArray;
    fdSelectOffset += start;
    topDict._fdSelect = parseCFFFDSelect(data, fdSelectOffset, font.numGlyphs, fdArray.length);
  }
  var privateDictOffset = start + topDict.private[1];
  var privateDict = parseCFFPrivateDict(data, privateDictOffset, topDict.private[0], stringIndex.objects);
  font.defaultWidthX = privateDict.defaultWidthX;
  font.nominalWidthX = privateDict.nominalWidthX;
  if (privateDict.subrs !== 0) {
    var subrOffset = privateDictOffset + privateDict.subrs;
    var subrIndex = parseCFFIndex(data, subrOffset);
    font.subrs = subrIndex.objects;
    font.subrsBias = calcCFFSubroutineBias(font.subrs);
  } else {
    font.subrs = [];
    font.subrsBias = 0;
  }
  var charStringsIndex;
  if (opt.lowMemory) {
    charStringsIndex = parseCFFIndexLowMemory(data, start + topDict.charStrings);
    font.nGlyphs = charStringsIndex.offsets.length;
  } else {
    charStringsIndex = parseCFFIndex(data, start + topDict.charStrings);
    font.nGlyphs = charStringsIndex.objects.length;
  }
  var charset = parseCFFCharset(data, start + topDict.charset, font.nGlyphs, stringIndex.objects);
  if (topDict.encoding === 0) {
    font.cffEncoding = new CffEncoding(cffStandardEncoding, charset);
  } else if (topDict.encoding === 1) {
    font.cffEncoding = new CffEncoding(cffExpertEncoding, charset);
  } else {
    font.cffEncoding = parseCFFEncoding(data, start + topDict.encoding, charset);
  }
  font.encoding = font.encoding || font.cffEncoding;
  font.glyphs = new glyphset.GlyphSet(font);
  if (opt.lowMemory) {
    font._push = function(i2) {
      var charString2 = getCffIndexObject(i2, charStringsIndex.offsets, data, start + topDict.charStrings);
      font.glyphs.push(i2, glyphset.cffGlyphLoader(font, i2, parseCFFCharstring, charString2));
    };
  } else {
    for (var i = 0; i < font.nGlyphs; i += 1) {
      var charString = charStringsIndex.objects[i];
      font.glyphs.push(i, glyphset.cffGlyphLoader(font, i, parseCFFCharstring, charString));
    }
  }
}
function encodeString(s, strings) {
  var sid;
  var i = cffStandardStrings.indexOf(s);
  if (i >= 0) {
    sid = i;
  }
  i = strings.indexOf(s);
  if (i >= 0) {
    sid = i + cffStandardStrings.length;
  } else {
    sid = cffStandardStrings.length + strings.length;
    strings.push(s);
  }
  return sid;
}
function makeHeader() {
  return new table.Record("Header", [
    { name: "major", type: "Card8", value: 1 },
    { name: "minor", type: "Card8", value: 0 },
    { name: "hdrSize", type: "Card8", value: 4 },
    { name: "major", type: "Card8", value: 1 }
  ]);
}
function makeNameIndex(fontNames) {
  var t = new table.Record("Name INDEX", [
    { name: "names", type: "INDEX", value: [] }
  ]);
  t.names = [];
  for (var i = 0; i < fontNames.length; i += 1) {
    t.names.push({ name: "name_" + i, type: "NAME", value: fontNames[i] });
  }
  return t;
}
function makeDict(meta2, attrs, strings) {
  var m = {};
  for (var i = 0; i < meta2.length; i += 1) {
    var entry = meta2[i];
    var value = attrs[entry.name];
    if (value !== void 0 && !equals(value, entry.value)) {
      if (entry.type === "SID") {
        value = encodeString(value, strings);
      }
      m[entry.op] = { name: entry.name, type: entry.type, value };
    }
  }
  return m;
}
function makeTopDict(attrs, strings) {
  var t = new table.Record("Top DICT", [
    { name: "dict", type: "DICT", value: {} }
  ]);
  t.dict = makeDict(TOP_DICT_META, attrs, strings);
  return t;
}
function makeTopDictIndex(topDict) {
  var t = new table.Record("Top DICT INDEX", [
    { name: "topDicts", type: "INDEX", value: [] }
  ]);
  t.topDicts = [{ name: "topDict_0", type: "TABLE", value: topDict }];
  return t;
}
function makeStringIndex(strings) {
  var t = new table.Record("String INDEX", [
    { name: "strings", type: "INDEX", value: [] }
  ]);
  t.strings = [];
  for (var i = 0; i < strings.length; i += 1) {
    t.strings.push({ name: "string_" + i, type: "STRING", value: strings[i] });
  }
  return t;
}
function makeGlobalSubrIndex() {
  return new table.Record("Global Subr INDEX", [
    { name: "subrs", type: "INDEX", value: [] }
  ]);
}
function makeCharsets(glyphNames, strings) {
  var t = new table.Record("Charsets", [
    { name: "format", type: "Card8", value: 0 }
  ]);
  for (var i = 0; i < glyphNames.length; i += 1) {
    var glyphName = glyphNames[i];
    var glyphSID = encodeString(glyphName, strings);
    t.fields.push({ name: "glyph_" + i, type: "SID", value: glyphSID });
  }
  return t;
}
function glyphToOps(glyph) {
  var ops = [];
  var path = glyph.path;
  ops.push({ name: "width", type: "NUMBER", value: glyph.advanceWidth });
  var x = 0;
  var y = 0;
  for (var i = 0; i < path.commands.length; i += 1) {
    var dx = void 0;
    var dy = void 0;
    var cmd = path.commands[i];
    if (cmd.type === "Q") {
      var _13 = 1 / 3;
      var _23 = 2 / 3;
      cmd = {
        type: "C",
        x: cmd.x,
        y: cmd.y,
        x1: Math.round(_13 * x + _23 * cmd.x1),
        y1: Math.round(_13 * y + _23 * cmd.y1),
        x2: Math.round(_13 * cmd.x + _23 * cmd.x1),
        y2: Math.round(_13 * cmd.y + _23 * cmd.y1)
      };
    }
    if (cmd.type === "M") {
      dx = Math.round(cmd.x - x);
      dy = Math.round(cmd.y - y);
      ops.push({ name: "dx", type: "NUMBER", value: dx });
      ops.push({ name: "dy", type: "NUMBER", value: dy });
      ops.push({ name: "rmoveto", type: "OP", value: 21 });
      x = Math.round(cmd.x);
      y = Math.round(cmd.y);
    } else if (cmd.type === "L") {
      dx = Math.round(cmd.x - x);
      dy = Math.round(cmd.y - y);
      ops.push({ name: "dx", type: "NUMBER", value: dx });
      ops.push({ name: "dy", type: "NUMBER", value: dy });
      ops.push({ name: "rlineto", type: "OP", value: 5 });
      x = Math.round(cmd.x);
      y = Math.round(cmd.y);
    } else if (cmd.type === "C") {
      var dx1 = Math.round(cmd.x1 - x);
      var dy1 = Math.round(cmd.y1 - y);
      var dx2 = Math.round(cmd.x2 - cmd.x1);
      var dy2 = Math.round(cmd.y2 - cmd.y1);
      dx = Math.round(cmd.x - cmd.x2);
      dy = Math.round(cmd.y - cmd.y2);
      ops.push({ name: "dx1", type: "NUMBER", value: dx1 });
      ops.push({ name: "dy1", type: "NUMBER", value: dy1 });
      ops.push({ name: "dx2", type: "NUMBER", value: dx2 });
      ops.push({ name: "dy2", type: "NUMBER", value: dy2 });
      ops.push({ name: "dx", type: "NUMBER", value: dx });
      ops.push({ name: "dy", type: "NUMBER", value: dy });
      ops.push({ name: "rrcurveto", type: "OP", value: 8 });
      x = Math.round(cmd.x);
      y = Math.round(cmd.y);
    }
  }
  ops.push({ name: "endchar", type: "OP", value: 14 });
  return ops;
}
function makeCharStringsIndex(glyphs) {
  var t = new table.Record("CharStrings INDEX", [
    { name: "charStrings", type: "INDEX", value: [] }
  ]);
  for (var i = 0; i < glyphs.length; i += 1) {
    var glyph = glyphs.get(i);
    var ops = glyphToOps(glyph);
    t.charStrings.push({ name: glyph.name, type: "CHARSTRING", value: ops });
  }
  return t;
}
function makePrivateDict(attrs, strings) {
  var t = new table.Record("Private DICT", [
    { name: "dict", type: "DICT", value: {} }
  ]);
  t.dict = makeDict(PRIVATE_DICT_META, attrs, strings);
  return t;
}
function makeCFFTable(glyphs, options) {
  var t = new table.Table("CFF ", [
    { name: "header", type: "RECORD" },
    { name: "nameIndex", type: "RECORD" },
    { name: "topDictIndex", type: "RECORD" },
    { name: "stringIndex", type: "RECORD" },
    { name: "globalSubrIndex", type: "RECORD" },
    { name: "charsets", type: "RECORD" },
    { name: "charStringsIndex", type: "RECORD" },
    { name: "privateDict", type: "RECORD" }
  ]);
  var fontScale = 1 / options.unitsPerEm;
  var attrs = {
    version: options.version,
    fullName: options.fullName,
    familyName: options.familyName,
    weight: options.weightName,
    fontBBox: options.fontBBox || [0, 0, 0, 0],
    fontMatrix: [fontScale, 0, 0, fontScale, 0, 0],
    charset: 999,
    encoding: 0,
    charStrings: 999,
    private: [0, 999]
  };
  var privateAttrs = {};
  var glyphNames = [];
  var glyph;
  for (var i = 1; i < glyphs.length; i += 1) {
    glyph = glyphs.get(i);
    glyphNames.push(glyph.name);
  }
  var strings = [];
  t.header = makeHeader();
  t.nameIndex = makeNameIndex([options.postScriptName]);
  var topDict = makeTopDict(attrs, strings);
  t.topDictIndex = makeTopDictIndex(topDict);
  t.globalSubrIndex = makeGlobalSubrIndex();
  t.charsets = makeCharsets(glyphNames, strings);
  t.charStringsIndex = makeCharStringsIndex(glyphs);
  t.privateDict = makePrivateDict(privateAttrs, strings);
  t.stringIndex = makeStringIndex(strings);
  var startOffset = t.header.sizeOf() + t.nameIndex.sizeOf() + t.topDictIndex.sizeOf() + t.stringIndex.sizeOf() + t.globalSubrIndex.sizeOf();
  attrs.charset = startOffset;
  attrs.encoding = 0;
  attrs.charStrings = attrs.charset + t.charsets.sizeOf();
  attrs.private[1] = attrs.charStrings + t.charStringsIndex.sizeOf();
  topDict = makeTopDict(attrs, strings);
  t.topDictIndex = makeTopDictIndex(topDict);
  return t;
}
var cff = { parse: parseCFFTable, make: makeCFFTable };
function parseHeadTable(data, start) {
  var head2 = {};
  var p = new parse.Parser(data, start);
  head2.version = p.parseVersion();
  head2.fontRevision = Math.round(p.parseFixed() * 1e3) / 1e3;
  head2.checkSumAdjustment = p.parseULong();
  head2.magicNumber = p.parseULong();
  check.argument(head2.magicNumber === 1594834165, "Font header has wrong magic number.");
  head2.flags = p.parseUShort();
  head2.unitsPerEm = p.parseUShort();
  head2.created = p.parseLongDateTime();
  head2.modified = p.parseLongDateTime();
  head2.xMin = p.parseShort();
  head2.yMin = p.parseShort();
  head2.xMax = p.parseShort();
  head2.yMax = p.parseShort();
  head2.macStyle = p.parseUShort();
  head2.lowestRecPPEM = p.parseUShort();
  head2.fontDirectionHint = p.parseShort();
  head2.indexToLocFormat = p.parseShort();
  head2.glyphDataFormat = p.parseShort();
  return head2;
}
function makeHeadTable(options) {
  var timestamp = Math.round((/* @__PURE__ */ new Date()).getTime() / 1e3) + 2082844800;
  var createdTimestamp = timestamp;
  if (options.createdTimestamp) {
    createdTimestamp = options.createdTimestamp + 2082844800;
  }
  return new table.Table("head", [
    { name: "version", type: "FIXED", value: 65536 },
    { name: "fontRevision", type: "FIXED", value: 65536 },
    { name: "checkSumAdjustment", type: "ULONG", value: 0 },
    { name: "magicNumber", type: "ULONG", value: 1594834165 },
    { name: "flags", type: "USHORT", value: 0 },
    { name: "unitsPerEm", type: "USHORT", value: 1e3 },
    { name: "created", type: "LONGDATETIME", value: createdTimestamp },
    { name: "modified", type: "LONGDATETIME", value: timestamp },
    { name: "xMin", type: "SHORT", value: 0 },
    { name: "yMin", type: "SHORT", value: 0 },
    { name: "xMax", type: "SHORT", value: 0 },
    { name: "yMax", type: "SHORT", value: 0 },
    { name: "macStyle", type: "USHORT", value: 0 },
    { name: "lowestRecPPEM", type: "USHORT", value: 0 },
    { name: "fontDirectionHint", type: "SHORT", value: 2 },
    { name: "indexToLocFormat", type: "SHORT", value: 0 },
    { name: "glyphDataFormat", type: "SHORT", value: 0 }
  ], options);
}
var head = { parse: parseHeadTable, make: makeHeadTable };
function parseHheaTable(data, start) {
  var hhea2 = {};
  var p = new parse.Parser(data, start);
  hhea2.version = p.parseVersion();
  hhea2.ascender = p.parseShort();
  hhea2.descender = p.parseShort();
  hhea2.lineGap = p.parseShort();
  hhea2.advanceWidthMax = p.parseUShort();
  hhea2.minLeftSideBearing = p.parseShort();
  hhea2.minRightSideBearing = p.parseShort();
  hhea2.xMaxExtent = p.parseShort();
  hhea2.caretSlopeRise = p.parseShort();
  hhea2.caretSlopeRun = p.parseShort();
  hhea2.caretOffset = p.parseShort();
  p.relativeOffset += 8;
  hhea2.metricDataFormat = p.parseShort();
  hhea2.numberOfHMetrics = p.parseUShort();
  return hhea2;
}
function makeHheaTable(options) {
  return new table.Table("hhea", [
    { name: "version", type: "FIXED", value: 65536 },
    { name: "ascender", type: "FWORD", value: 0 },
    { name: "descender", type: "FWORD", value: 0 },
    { name: "lineGap", type: "FWORD", value: 0 },
    { name: "advanceWidthMax", type: "UFWORD", value: 0 },
    { name: "minLeftSideBearing", type: "FWORD", value: 0 },
    { name: "minRightSideBearing", type: "FWORD", value: 0 },
    { name: "xMaxExtent", type: "FWORD", value: 0 },
    { name: "caretSlopeRise", type: "SHORT", value: 1 },
    { name: "caretSlopeRun", type: "SHORT", value: 0 },
    { name: "caretOffset", type: "SHORT", value: 0 },
    { name: "reserved1", type: "SHORT", value: 0 },
    { name: "reserved2", type: "SHORT", value: 0 },
    { name: "reserved3", type: "SHORT", value: 0 },
    { name: "reserved4", type: "SHORT", value: 0 },
    { name: "metricDataFormat", type: "SHORT", value: 0 },
    { name: "numberOfHMetrics", type: "USHORT", value: 0 }
  ], options);
}
var hhea = { parse: parseHheaTable, make: makeHheaTable };
function parseHmtxTableAll(data, start, numMetrics, numGlyphs, glyphs) {
  var advanceWidth;
  var leftSideBearing;
  var p = new parse.Parser(data, start);
  for (var i = 0; i < numGlyphs; i += 1) {
    if (i < numMetrics) {
      advanceWidth = p.parseUShort();
      leftSideBearing = p.parseShort();
    }
    var glyph = glyphs.get(i);
    glyph.advanceWidth = advanceWidth;
    glyph.leftSideBearing = leftSideBearing;
  }
}
function parseHmtxTableOnLowMemory(font, data, start, numMetrics, numGlyphs) {
  font._hmtxTableData = {};
  var advanceWidth;
  var leftSideBearing;
  var p = new parse.Parser(data, start);
  for (var i = 0; i < numGlyphs; i += 1) {
    if (i < numMetrics) {
      advanceWidth = p.parseUShort();
      leftSideBearing = p.parseShort();
    }
    font._hmtxTableData[i] = {
      advanceWidth,
      leftSideBearing
    };
  }
}
function parseHmtxTable(font, data, start, numMetrics, numGlyphs, glyphs, opt) {
  if (opt.lowMemory) {
    parseHmtxTableOnLowMemory(font, data, start, numMetrics, numGlyphs);
  } else {
    parseHmtxTableAll(data, start, numMetrics, numGlyphs, glyphs);
  }
}
function makeHmtxTable(glyphs) {
  var t = new table.Table("hmtx", []);
  for (var i = 0; i < glyphs.length; i += 1) {
    var glyph = glyphs.get(i);
    var advanceWidth = glyph.advanceWidth || 0;
    var leftSideBearing = glyph.leftSideBearing || 0;
    t.fields.push({ name: "advanceWidth_" + i, type: "USHORT", value: advanceWidth });
    t.fields.push({ name: "leftSideBearing_" + i, type: "SHORT", value: leftSideBearing });
  }
  return t;
}
var hmtx = { parse: parseHmtxTable, make: makeHmtxTable };
function makeLtagTable(tags) {
  var result = new table.Table("ltag", [
    { name: "version", type: "ULONG", value: 1 },
    { name: "flags", type: "ULONG", value: 0 },
    { name: "numTags", type: "ULONG", value: tags.length }
  ]);
  var stringPool = "";
  var stringPoolOffset = 12 + tags.length * 4;
  for (var i = 0; i < tags.length; ++i) {
    var pos = stringPool.indexOf(tags[i]);
    if (pos < 0) {
      pos = stringPool.length;
      stringPool += tags[i];
    }
    result.fields.push({ name: "offset " + i, type: "USHORT", value: stringPoolOffset + pos });
    result.fields.push({ name: "length " + i, type: "USHORT", value: tags[i].length });
  }
  result.fields.push({ name: "stringPool", type: "CHARARRAY", value: stringPool });
  return result;
}
function parseLtagTable(data, start) {
  var p = new parse.Parser(data, start);
  var tableVersion = p.parseULong();
  check.argument(tableVersion === 1, "Unsupported ltag table version.");
  p.skip("uLong", 1);
  var numTags = p.parseULong();
  var tags = [];
  for (var i = 0; i < numTags; i++) {
    var tag = "";
    var offset = start + p.parseUShort();
    var length = p.parseUShort();
    for (var j = offset; j < offset + length; ++j) {
      tag += String.fromCharCode(data.getInt8(j));
    }
    tags.push(tag);
  }
  return tags;
}
var ltag = { make: makeLtagTable, parse: parseLtagTable };
function parseMaxpTable(data, start) {
  var maxp2 = {};
  var p = new parse.Parser(data, start);
  maxp2.version = p.parseVersion();
  maxp2.numGlyphs = p.parseUShort();
  if (maxp2.version === 1) {
    maxp2.maxPoints = p.parseUShort();
    maxp2.maxContours = p.parseUShort();
    maxp2.maxCompositePoints = p.parseUShort();
    maxp2.maxCompositeContours = p.parseUShort();
    maxp2.maxZones = p.parseUShort();
    maxp2.maxTwilightPoints = p.parseUShort();
    maxp2.maxStorage = p.parseUShort();
    maxp2.maxFunctionDefs = p.parseUShort();
    maxp2.maxInstructionDefs = p.parseUShort();
    maxp2.maxStackElements = p.parseUShort();
    maxp2.maxSizeOfInstructions = p.parseUShort();
    maxp2.maxComponentElements = p.parseUShort();
    maxp2.maxComponentDepth = p.parseUShort();
  }
  return maxp2;
}
function makeMaxpTable(numGlyphs) {
  return new table.Table("maxp", [
    { name: "version", type: "FIXED", value: 20480 },
    { name: "numGlyphs", type: "USHORT", value: numGlyphs }
  ]);
}
var maxp = { parse: parseMaxpTable, make: makeMaxpTable };
var nameTableNames = [
  "copyright",
  // 0
  "fontFamily",
  // 1
  "fontSubfamily",
  // 2
  "uniqueID",
  // 3
  "fullName",
  // 4
  "version",
  // 5
  "postScriptName",
  // 6
  "trademark",
  // 7
  "manufacturer",
  // 8
  "designer",
  // 9
  "description",
  // 10
  "manufacturerURL",
  // 11
  "designerURL",
  // 12
  "license",
  // 13
  "licenseURL",
  // 14
  "reserved",
  // 15
  "preferredFamily",
  // 16
  "preferredSubfamily",
  // 17
  "compatibleFullName",
  // 18
  "sampleText",
  // 19
  "postScriptFindFontName",
  // 20
  "wwsFamily",
  // 21
  "wwsSubfamily"
  // 22
];
var macLanguages = {
  0: "en",
  1: "fr",
  2: "de",
  3: "it",
  4: "nl",
  5: "sv",
  6: "es",
  7: "da",
  8: "pt",
  9: "no",
  10: "he",
  11: "ja",
  12: "ar",
  13: "fi",
  14: "el",
  15: "is",
  16: "mt",
  17: "tr",
  18: "hr",
  19: "zh-Hant",
  20: "ur",
  21: "hi",
  22: "th",
  23: "ko",
  24: "lt",
  25: "pl",
  26: "hu",
  27: "es",
  28: "lv",
  29: "se",
  30: "fo",
  31: "fa",
  32: "ru",
  33: "zh",
  34: "nl-BE",
  35: "ga",
  36: "sq",
  37: "ro",
  38: "cz",
  39: "sk",
  40: "si",
  41: "yi",
  42: "sr",
  43: "mk",
  44: "bg",
  45: "uk",
  46: "be",
  47: "uz",
  48: "kk",
  49: "az-Cyrl",
  50: "az-Arab",
  51: "hy",
  52: "ka",
  53: "mo",
  54: "ky",
  55: "tg",
  56: "tk",
  57: "mn-CN",
  58: "mn",
  59: "ps",
  60: "ks",
  61: "ku",
  62: "sd",
  63: "bo",
  64: "ne",
  65: "sa",
  66: "mr",
  67: "bn",
  68: "as",
  69: "gu",
  70: "pa",
  71: "or",
  72: "ml",
  73: "kn",
  74: "ta",
  75: "te",
  76: "si",
  77: "my",
  78: "km",
  79: "lo",
  80: "vi",
  81: "id",
  82: "tl",
  83: "ms",
  84: "ms-Arab",
  85: "am",
  86: "ti",
  87: "om",
  88: "so",
  89: "sw",
  90: "rw",
  91: "rn",
  92: "ny",
  93: "mg",
  94: "eo",
  128: "cy",
  129: "eu",
  130: "ca",
  131: "la",
  132: "qu",
  133: "gn",
  134: "ay",
  135: "tt",
  136: "ug",
  137: "dz",
  138: "jv",
  139: "su",
  140: "gl",
  141: "af",
  142: "br",
  143: "iu",
  144: "gd",
  145: "gv",
  146: "ga",
  147: "to",
  148: "el-polyton",
  149: "kl",
  150: "az",
  151: "nn"
};
var macLanguageToScript = {
  0: 0,
  // langEnglish → smRoman
  1: 0,
  // langFrench → smRoman
  2: 0,
  // langGerman → smRoman
  3: 0,
  // langItalian → smRoman
  4: 0,
  // langDutch → smRoman
  5: 0,
  // langSwedish → smRoman
  6: 0,
  // langSpanish → smRoman
  7: 0,
  // langDanish → smRoman
  8: 0,
  // langPortuguese → smRoman
  9: 0,
  // langNorwegian → smRoman
  10: 5,
  // langHebrew → smHebrew
  11: 1,
  // langJapanese → smJapanese
  12: 4,
  // langArabic → smArabic
  13: 0,
  // langFinnish → smRoman
  14: 6,
  // langGreek → smGreek
  15: 0,
  // langIcelandic → smRoman (modified)
  16: 0,
  // langMaltese → smRoman
  17: 0,
  // langTurkish → smRoman (modified)
  18: 0,
  // langCroatian → smRoman (modified)
  19: 2,
  // langTradChinese → smTradChinese
  20: 4,
  // langUrdu → smArabic
  21: 9,
  // langHindi → smDevanagari
  22: 21,
  // langThai → smThai
  23: 3,
  // langKorean → smKorean
  24: 29,
  // langLithuanian → smCentralEuroRoman
  25: 29,
  // langPolish → smCentralEuroRoman
  26: 29,
  // langHungarian → smCentralEuroRoman
  27: 29,
  // langEstonian → smCentralEuroRoman
  28: 29,
  // langLatvian → smCentralEuroRoman
  29: 0,
  // langSami → smRoman
  30: 0,
  // langFaroese → smRoman (modified)
  31: 4,
  // langFarsi → smArabic (modified)
  32: 7,
  // langRussian → smCyrillic
  33: 25,
  // langSimpChinese → smSimpChinese
  34: 0,
  // langFlemish → smRoman
  35: 0,
  // langIrishGaelic → smRoman (modified)
  36: 0,
  // langAlbanian → smRoman
  37: 0,
  // langRomanian → smRoman (modified)
  38: 29,
  // langCzech → smCentralEuroRoman
  39: 29,
  // langSlovak → smCentralEuroRoman
  40: 0,
  // langSlovenian → smRoman (modified)
  41: 5,
  // langYiddish → smHebrew
  42: 7,
  // langSerbian → smCyrillic
  43: 7,
  // langMacedonian → smCyrillic
  44: 7,
  // langBulgarian → smCyrillic
  45: 7,
  // langUkrainian → smCyrillic (modified)
  46: 7,
  // langByelorussian → smCyrillic
  47: 7,
  // langUzbek → smCyrillic
  48: 7,
  // langKazakh → smCyrillic
  49: 7,
  // langAzerbaijani → smCyrillic
  50: 4,
  // langAzerbaijanAr → smArabic
  51: 24,
  // langArmenian → smArmenian
  52: 23,
  // langGeorgian → smGeorgian
  53: 7,
  // langMoldavian → smCyrillic
  54: 7,
  // langKirghiz → smCyrillic
  55: 7,
  // langTajiki → smCyrillic
  56: 7,
  // langTurkmen → smCyrillic
  57: 27,
  // langMongolian → smMongolian
  58: 7,
  // langMongolianCyr → smCyrillic
  59: 4,
  // langPashto → smArabic
  60: 4,
  // langKurdish → smArabic
  61: 4,
  // langKashmiri → smArabic
  62: 4,
  // langSindhi → smArabic
  63: 26,
  // langTibetan → smTibetan
  64: 9,
  // langNepali → smDevanagari
  65: 9,
  // langSanskrit → smDevanagari
  66: 9,
  // langMarathi → smDevanagari
  67: 13,
  // langBengali → smBengali
  68: 13,
  // langAssamese → smBengali
  69: 11,
  // langGujarati → smGujarati
  70: 10,
  // langPunjabi → smGurmukhi
  71: 12,
  // langOriya → smOriya
  72: 17,
  // langMalayalam → smMalayalam
  73: 16,
  // langKannada → smKannada
  74: 14,
  // langTamil → smTamil
  75: 15,
  // langTelugu → smTelugu
  76: 18,
  // langSinhalese → smSinhalese
  77: 19,
  // langBurmese → smBurmese
  78: 20,
  // langKhmer → smKhmer
  79: 22,
  // langLao → smLao
  80: 30,
  // langVietnamese → smVietnamese
  81: 0,
  // langIndonesian → smRoman
  82: 0,
  // langTagalog → smRoman
  83: 0,
  // langMalayRoman → smRoman
  84: 4,
  // langMalayArabic → smArabic
  85: 28,
  // langAmharic → smEthiopic
  86: 28,
  // langTigrinya → smEthiopic
  87: 28,
  // langOromo → smEthiopic
  88: 0,
  // langSomali → smRoman
  89: 0,
  // langSwahili → smRoman
  90: 0,
  // langKinyarwanda → smRoman
  91: 0,
  // langRundi → smRoman
  92: 0,
  // langNyanja → smRoman
  93: 0,
  // langMalagasy → smRoman
  94: 0,
  // langEsperanto → smRoman
  128: 0,
  // langWelsh → smRoman (modified)
  129: 0,
  // langBasque → smRoman
  130: 0,
  // langCatalan → smRoman
  131: 0,
  // langLatin → smRoman
  132: 0,
  // langQuechua → smRoman
  133: 0,
  // langGuarani → smRoman
  134: 0,
  // langAymara → smRoman
  135: 7,
  // langTatar → smCyrillic
  136: 4,
  // langUighur → smArabic
  137: 26,
  // langDzongkha → smTibetan
  138: 0,
  // langJavaneseRom → smRoman
  139: 0,
  // langSundaneseRom → smRoman
  140: 0,
  // langGalician → smRoman
  141: 0,
  // langAfrikaans → smRoman
  142: 0,
  // langBreton → smRoman (modified)
  143: 28,
  // langInuktitut → smEthiopic (modified)
  144: 0,
  // langScottishGaelic → smRoman (modified)
  145: 0,
  // langManxGaelic → smRoman (modified)
  146: 0,
  // langIrishGaelicScript → smRoman (modified)
  147: 0,
  // langTongan → smRoman
  148: 6,
  // langGreekAncient → smRoman
  149: 0,
  // langGreenlandic → smRoman
  150: 0,
  // langAzerbaijanRoman → smRoman
  151: 0
  // langNynorsk → smRoman
};
var windowsLanguages = {
  1078: "af",
  1052: "sq",
  1156: "gsw",
  1118: "am",
  5121: "ar-DZ",
  15361: "ar-BH",
  3073: "ar",
  2049: "ar-IQ",
  11265: "ar-JO",
  13313: "ar-KW",
  12289: "ar-LB",
  4097: "ar-LY",
  6145: "ary",
  8193: "ar-OM",
  16385: "ar-QA",
  1025: "ar-SA",
  10241: "ar-SY",
  7169: "aeb",
  14337: "ar-AE",
  9217: "ar-YE",
  1067: "hy",
  1101: "as",
  2092: "az-Cyrl",
  1068: "az",
  1133: "ba",
  1069: "eu",
  1059: "be",
  2117: "bn",
  1093: "bn-IN",
  8218: "bs-Cyrl",
  5146: "bs",
  1150: "br",
  1026: "bg",
  1027: "ca",
  3076: "zh-HK",
  5124: "zh-MO",
  2052: "zh",
  4100: "zh-SG",
  1028: "zh-TW",
  1155: "co",
  1050: "hr",
  4122: "hr-BA",
  1029: "cs",
  1030: "da",
  1164: "prs",
  1125: "dv",
  2067: "nl-BE",
  1043: "nl",
  3081: "en-AU",
  10249: "en-BZ",
  4105: "en-CA",
  9225: "en-029",
  16393: "en-IN",
  6153: "en-IE",
  8201: "en-JM",
  17417: "en-MY",
  5129: "en-NZ",
  13321: "en-PH",
  18441: "en-SG",
  7177: "en-ZA",
  11273: "en-TT",
  2057: "en-GB",
  1033: "en",
  12297: "en-ZW",
  1061: "et",
  1080: "fo",
  1124: "fil",
  1035: "fi",
  2060: "fr-BE",
  3084: "fr-CA",
  1036: "fr",
  5132: "fr-LU",
  6156: "fr-MC",
  4108: "fr-CH",
  1122: "fy",
  1110: "gl",
  1079: "ka",
  3079: "de-AT",
  1031: "de",
  5127: "de-LI",
  4103: "de-LU",
  2055: "de-CH",
  1032: "el",
  1135: "kl",
  1095: "gu",
  1128: "ha",
  1037: "he",
  1081: "hi",
  1038: "hu",
  1039: "is",
  1136: "ig",
  1057: "id",
  1117: "iu",
  2141: "iu-Latn",
  2108: "ga",
  1076: "xh",
  1077: "zu",
  1040: "it",
  2064: "it-CH",
  1041: "ja",
  1099: "kn",
  1087: "kk",
  1107: "km",
  1158: "quc",
  1159: "rw",
  1089: "sw",
  1111: "kok",
  1042: "ko",
  1088: "ky",
  1108: "lo",
  1062: "lv",
  1063: "lt",
  2094: "dsb",
  1134: "lb",
  1071: "mk",
  2110: "ms-BN",
  1086: "ms",
  1100: "ml",
  1082: "mt",
  1153: "mi",
  1146: "arn",
  1102: "mr",
  1148: "moh",
  1104: "mn",
  2128: "mn-CN",
  1121: "ne",
  1044: "nb",
  2068: "nn",
  1154: "oc",
  1096: "or",
  1123: "ps",
  1045: "pl",
  1046: "pt",
  2070: "pt-PT",
  1094: "pa",
  1131: "qu-BO",
  2155: "qu-EC",
  3179: "qu",
  1048: "ro",
  1047: "rm",
  1049: "ru",
  9275: "smn",
  4155: "smj-NO",
  5179: "smj",
  3131: "se-FI",
  1083: "se",
  2107: "se-SE",
  8251: "sms",
  6203: "sma-NO",
  7227: "sms",
  1103: "sa",
  7194: "sr-Cyrl-BA",
  3098: "sr",
  6170: "sr-Latn-BA",
  2074: "sr-Latn",
  1132: "nso",
  1074: "tn",
  1115: "si",
  1051: "sk",
  1060: "sl",
  11274: "es-AR",
  16394: "es-BO",
  13322: "es-CL",
  9226: "es-CO",
  5130: "es-CR",
  7178: "es-DO",
  12298: "es-EC",
  17418: "es-SV",
  4106: "es-GT",
  18442: "es-HN",
  2058: "es-MX",
  19466: "es-NI",
  6154: "es-PA",
  15370: "es-PY",
  10250: "es-PE",
  20490: "es-PR",
  // Microsoft has defined two different language codes for
  // “Spanish with modern sorting” and “Spanish with traditional
  // sorting”. This makes sense for collation APIs, and it would be
  // possible to express this in BCP 47 language tags via Unicode
  // extensions (eg., es-u-co-trad is Spanish with traditional
  // sorting). However, for storing names in fonts, the distinction
  // does not make sense, so we give “es” in both cases.
  3082: "es",
  1034: "es",
  21514: "es-US",
  14346: "es-UY",
  8202: "es-VE",
  2077: "sv-FI",
  1053: "sv",
  1114: "syr",
  1064: "tg",
  2143: "tzm",
  1097: "ta",
  1092: "tt",
  1098: "te",
  1054: "th",
  1105: "bo",
  1055: "tr",
  1090: "tk",
  1152: "ug",
  1058: "uk",
  1070: "hsb",
  1056: "ur",
  2115: "uz-Cyrl",
  1091: "uz",
  1066: "vi",
  1106: "cy",
  1160: "wo",
  1157: "sah",
  1144: "ii",
  1130: "yo"
};
function getLanguageCode(platformID, languageID, ltag2) {
  switch (platformID) {
    case 0:
      if (languageID === 65535) {
        return "und";
      } else if (ltag2) {
        return ltag2[languageID];
      }
      break;
    case 1:
      return macLanguages[languageID];
    case 3:
      return windowsLanguages[languageID];
  }
  return void 0;
}
var utf16 = "utf-16";
var macScriptEncodings = {
  0: "macintosh",
  // smRoman
  1: "x-mac-japanese",
  // smJapanese
  2: "x-mac-chinesetrad",
  // smTradChinese
  3: "x-mac-korean",
  // smKorean
  6: "x-mac-greek",
  // smGreek
  7: "x-mac-cyrillic",
  // smCyrillic
  9: "x-mac-devanagai",
  // smDevanagari
  10: "x-mac-gurmukhi",
  // smGurmukhi
  11: "x-mac-gujarati",
  // smGujarati
  12: "x-mac-oriya",
  // smOriya
  13: "x-mac-bengali",
  // smBengali
  14: "x-mac-tamil",
  // smTamil
  15: "x-mac-telugu",
  // smTelugu
  16: "x-mac-kannada",
  // smKannada
  17: "x-mac-malayalam",
  // smMalayalam
  18: "x-mac-sinhalese",
  // smSinhalese
  19: "x-mac-burmese",
  // smBurmese
  20: "x-mac-khmer",
  // smKhmer
  21: "x-mac-thai",
  // smThai
  22: "x-mac-lao",
  // smLao
  23: "x-mac-georgian",
  // smGeorgian
  24: "x-mac-armenian",
  // smArmenian
  25: "x-mac-chinesesimp",
  // smSimpChinese
  26: "x-mac-tibetan",
  // smTibetan
  27: "x-mac-mongolian",
  // smMongolian
  28: "x-mac-ethiopic",
  // smEthiopic
  29: "x-mac-ce",
  // smCentralEuroRoman
  30: "x-mac-vietnamese",
  // smVietnamese
  31: "x-mac-extarabic"
  // smExtArabic
};
var macLanguageEncodings = {
  15: "x-mac-icelandic",
  // langIcelandic
  17: "x-mac-turkish",
  // langTurkish
  18: "x-mac-croatian",
  // langCroatian
  24: "x-mac-ce",
  // langLithuanian
  25: "x-mac-ce",
  // langPolish
  26: "x-mac-ce",
  // langHungarian
  27: "x-mac-ce",
  // langEstonian
  28: "x-mac-ce",
  // langLatvian
  30: "x-mac-icelandic",
  // langFaroese
  37: "x-mac-romanian",
  // langRomanian
  38: "x-mac-ce",
  // langCzech
  39: "x-mac-ce",
  // langSlovak
  40: "x-mac-ce",
  // langSlovenian
  143: "x-mac-inuit",
  // langInuktitut
  146: "x-mac-gaelic"
  // langIrishGaelicScript
};
function getEncoding(platformID, encodingID, languageID) {
  switch (platformID) {
    case 0:
      return utf16;
    case 1:
      return macLanguageEncodings[languageID] || macScriptEncodings[encodingID];
    case 3:
      if (encodingID === 1 || encodingID === 10) {
        return utf16;
      }
      break;
  }
  return void 0;
}
function parseNameTable(data, start, ltag2) {
  var name = {};
  var p = new parse.Parser(data, start);
  var format = p.parseUShort();
  var count = p.parseUShort();
  var stringOffset = p.offset + p.parseUShort();
  for (var i = 0; i < count; i++) {
    var platformID = p.parseUShort();
    var encodingID = p.parseUShort();
    var languageID = p.parseUShort();
    var nameID = p.parseUShort();
    var property = nameTableNames[nameID] || nameID;
    var byteLength = p.parseUShort();
    var offset = p.parseUShort();
    var language = getLanguageCode(platformID, languageID, ltag2);
    var encoding = getEncoding(platformID, encodingID, languageID);
    if (encoding !== void 0 && language !== void 0) {
      var text = void 0;
      if (encoding === utf16) {
        text = decode.UTF16(data, stringOffset + offset, byteLength);
      } else {
        text = decode.MACSTRING(data, stringOffset + offset, byteLength, encoding);
      }
      if (text) {
        var translations = name[property];
        if (translations === void 0) {
          translations = name[property] = {};
        }
        translations[language] = text;
      }
    }
  }
  var langTagCount = 0;
  if (format === 1) {
    langTagCount = p.parseUShort();
  }
  return name;
}
function reverseDict(dict) {
  var result = {};
  for (var key in dict) {
    result[dict[key]] = parseInt(key);
  }
  return result;
}
function makeNameRecord(platformID, encodingID, languageID, nameID, length, offset) {
  return new table.Record("NameRecord", [
    { name: "platformID", type: "USHORT", value: platformID },
    { name: "encodingID", type: "USHORT", value: encodingID },
    { name: "languageID", type: "USHORT", value: languageID },
    { name: "nameID", type: "USHORT", value: nameID },
    { name: "length", type: "USHORT", value: length },
    { name: "offset", type: "USHORT", value: offset }
  ]);
}
function findSubArray(needle, haystack) {
  var needleLength = needle.length;
  var limit = haystack.length - needleLength + 1;
  loop:
    for (var pos = 0; pos < limit; pos++) {
      for (; pos < limit; pos++) {
        for (var k = 0; k < needleLength; k++) {
          if (haystack[pos + k] !== needle[k]) {
            continue loop;
          }
        }
        return pos;
      }
    }
  return -1;
}
function addStringToPool(s, pool) {
  var offset = findSubArray(s, pool);
  if (offset < 0) {
    offset = pool.length;
    var i = 0;
    var len = s.length;
    for (; i < len; ++i) {
      pool.push(s[i]);
    }
  }
  return offset;
}
function makeNameTable(names, ltag2) {
  var nameID;
  var nameIDs = [];
  var namesWithNumericKeys = {};
  var nameTableIds = reverseDict(nameTableNames);
  for (var key in names) {
    var id = nameTableIds[key];
    if (id === void 0) {
      id = key;
    }
    nameID = parseInt(id);
    if (isNaN(nameID)) {
      throw new Error('Name table entry "' + key + '" does not exist, see nameTableNames for complete list.');
    }
    namesWithNumericKeys[nameID] = names[key];
    nameIDs.push(nameID);
  }
  var macLanguageIds = reverseDict(macLanguages);
  var windowsLanguageIds = reverseDict(windowsLanguages);
  var nameRecords = [];
  var stringPool = [];
  for (var i = 0; i < nameIDs.length; i++) {
    nameID = nameIDs[i];
    var translations = namesWithNumericKeys[nameID];
    for (var lang in translations) {
      var text = translations[lang];
      var macPlatform = 1;
      var macLanguage = macLanguageIds[lang];
      var macScript = macLanguageToScript[macLanguage];
      var macEncoding = getEncoding(macPlatform, macScript, macLanguage);
      var macName = encode.MACSTRING(text, macEncoding);
      if (macName === void 0) {
        macPlatform = 0;
        macLanguage = ltag2.indexOf(lang);
        if (macLanguage < 0) {
          macLanguage = ltag2.length;
          ltag2.push(lang);
        }
        macScript = 4;
        macName = encode.UTF16(text);
      }
      var macNameOffset = addStringToPool(macName, stringPool);
      nameRecords.push(makeNameRecord(
        macPlatform,
        macScript,
        macLanguage,
        nameID,
        macName.length,
        macNameOffset
      ));
      var winLanguage = windowsLanguageIds[lang];
      if (winLanguage !== void 0) {
        var winName = encode.UTF16(text);
        var winNameOffset = addStringToPool(winName, stringPool);
        nameRecords.push(makeNameRecord(
          3,
          1,
          winLanguage,
          nameID,
          winName.length,
          winNameOffset
        ));
      }
    }
  }
  nameRecords.sort(function(a, b) {
    return a.platformID - b.platformID || a.encodingID - b.encodingID || a.languageID - b.languageID || a.nameID - b.nameID;
  });
  var t = new table.Table("name", [
    { name: "format", type: "USHORT", value: 0 },
    { name: "count", type: "USHORT", value: nameRecords.length },
    { name: "stringOffset", type: "USHORT", value: 6 + nameRecords.length * 12 }
  ]);
  for (var r = 0; r < nameRecords.length; r++) {
    t.fields.push({ name: "record_" + r, type: "RECORD", value: nameRecords[r] });
  }
  t.fields.push({ name: "strings", type: "LITERAL", value: stringPool });
  return t;
}
var _name = { parse: parseNameTable, make: makeNameTable };
var unicodeRanges = [
  { begin: 0, end: 127 },
  // Basic Latin
  { begin: 128, end: 255 },
  // Latin-1 Supplement
  { begin: 256, end: 383 },
  // Latin Extended-A
  { begin: 384, end: 591 },
  // Latin Extended-B
  { begin: 592, end: 687 },
  // IPA Extensions
  { begin: 688, end: 767 },
  // Spacing Modifier Letters
  { begin: 768, end: 879 },
  // Combining Diacritical Marks
  { begin: 880, end: 1023 },
  // Greek and Coptic
  { begin: 11392, end: 11519 },
  // Coptic
  { begin: 1024, end: 1279 },
  // Cyrillic
  { begin: 1328, end: 1423 },
  // Armenian
  { begin: 1424, end: 1535 },
  // Hebrew
  { begin: 42240, end: 42559 },
  // Vai
  { begin: 1536, end: 1791 },
  // Arabic
  { begin: 1984, end: 2047 },
  // NKo
  { begin: 2304, end: 2431 },
  // Devanagari
  { begin: 2432, end: 2559 },
  // Bengali
  { begin: 2560, end: 2687 },
  // Gurmukhi
  { begin: 2688, end: 2815 },
  // Gujarati
  { begin: 2816, end: 2943 },
  // Oriya
  { begin: 2944, end: 3071 },
  // Tamil
  { begin: 3072, end: 3199 },
  // Telugu
  { begin: 3200, end: 3327 },
  // Kannada
  { begin: 3328, end: 3455 },
  // Malayalam
  { begin: 3584, end: 3711 },
  // Thai
  { begin: 3712, end: 3839 },
  // Lao
  { begin: 4256, end: 4351 },
  // Georgian
  { begin: 6912, end: 7039 },
  // Balinese
  { begin: 4352, end: 4607 },
  // Hangul Jamo
  { begin: 7680, end: 7935 },
  // Latin Extended Additional
  { begin: 7936, end: 8191 },
  // Greek Extended
  { begin: 8192, end: 8303 },
  // General Punctuation
  { begin: 8304, end: 8351 },
  // Superscripts And Subscripts
  { begin: 8352, end: 8399 },
  // Currency Symbol
  { begin: 8400, end: 8447 },
  // Combining Diacritical Marks For Symbols
  { begin: 8448, end: 8527 },
  // Letterlike Symbols
  { begin: 8528, end: 8591 },
  // Number Forms
  { begin: 8592, end: 8703 },
  // Arrows
  { begin: 8704, end: 8959 },
  // Mathematical Operators
  { begin: 8960, end: 9215 },
  // Miscellaneous Technical
  { begin: 9216, end: 9279 },
  // Control Pictures
  { begin: 9280, end: 9311 },
  // Optical Character Recognition
  { begin: 9312, end: 9471 },
  // Enclosed Alphanumerics
  { begin: 9472, end: 9599 },
  // Box Drawing
  { begin: 9600, end: 9631 },
  // Block Elements
  { begin: 9632, end: 9727 },
  // Geometric Shapes
  { begin: 9728, end: 9983 },
  // Miscellaneous Symbols
  { begin: 9984, end: 10175 },
  // Dingbats
  { begin: 12288, end: 12351 },
  // CJK Symbols And Punctuation
  { begin: 12352, end: 12447 },
  // Hiragana
  { begin: 12448, end: 12543 },
  // Katakana
  { begin: 12544, end: 12591 },
  // Bopomofo
  { begin: 12592, end: 12687 },
  // Hangul Compatibility Jamo
  { begin: 43072, end: 43135 },
  // Phags-pa
  { begin: 12800, end: 13055 },
  // Enclosed CJK Letters And Months
  { begin: 13056, end: 13311 },
  // CJK Compatibility
  { begin: 44032, end: 55215 },
  // Hangul Syllables
  { begin: 55296, end: 57343 },
  // Non-Plane 0 *
  { begin: 67840, end: 67871 },
  // Phoenicia
  { begin: 19968, end: 40959 },
  // CJK Unified Ideographs
  { begin: 57344, end: 63743 },
  // Private Use Area (plane 0)
  { begin: 12736, end: 12783 },
  // CJK Strokes
  { begin: 64256, end: 64335 },
  // Alphabetic Presentation Forms
  { begin: 64336, end: 65023 },
  // Arabic Presentation Forms-A
  { begin: 65056, end: 65071 },
  // Combining Half Marks
  { begin: 65040, end: 65055 },
  // Vertical Forms
  { begin: 65104, end: 65135 },
  // Small Form Variants
  { begin: 65136, end: 65279 },
  // Arabic Presentation Forms-B
  { begin: 65280, end: 65519 },
  // Halfwidth And Fullwidth Forms
  { begin: 65520, end: 65535 },
  // Specials
  { begin: 3840, end: 4095 },
  // Tibetan
  { begin: 1792, end: 1871 },
  // Syriac
  { begin: 1920, end: 1983 },
  // Thaana
  { begin: 3456, end: 3583 },
  // Sinhala
  { begin: 4096, end: 4255 },
  // Myanmar
  { begin: 4608, end: 4991 },
  // Ethiopic
  { begin: 5024, end: 5119 },
  // Cherokee
  { begin: 5120, end: 5759 },
  // Unified Canadian Aboriginal Syllabics
  { begin: 5760, end: 5791 },
  // Ogham
  { begin: 5792, end: 5887 },
  // Runic
  { begin: 6016, end: 6143 },
  // Khmer
  { begin: 6144, end: 6319 },
  // Mongolian
  { begin: 10240, end: 10495 },
  // Braille Patterns
  { begin: 40960, end: 42127 },
  // Yi Syllables
  { begin: 5888, end: 5919 },
  // Tagalog
  { begin: 66304, end: 66351 },
  // Old Italic
  { begin: 66352, end: 66383 },
  // Gothic
  { begin: 66560, end: 66639 },
  // Deseret
  { begin: 118784, end: 119039 },
  // Byzantine Musical Symbols
  { begin: 119808, end: 120831 },
  // Mathematical Alphanumeric Symbols
  { begin: 1044480, end: 1048573 },
  // Private Use (plane 15)
  { begin: 65024, end: 65039 },
  // Variation Selectors
  { begin: 917504, end: 917631 },
  // Tags
  { begin: 6400, end: 6479 },
  // Limbu
  { begin: 6480, end: 6527 },
  // Tai Le
  { begin: 6528, end: 6623 },
  // New Tai Lue
  { begin: 6656, end: 6687 },
  // Buginese
  { begin: 11264, end: 11359 },
  // Glagolitic
  { begin: 11568, end: 11647 },
  // Tifinagh
  { begin: 19904, end: 19967 },
  // Yijing Hexagram Symbols
  { begin: 43008, end: 43055 },
  // Syloti Nagri
  { begin: 65536, end: 65663 },
  // Linear B Syllabary
  { begin: 65856, end: 65935 },
  // Ancient Greek Numbers
  { begin: 66432, end: 66463 },
  // Ugaritic
  { begin: 66464, end: 66527 },
  // Old Persian
  { begin: 66640, end: 66687 },
  // Shavian
  { begin: 66688, end: 66735 },
  // Osmanya
  { begin: 67584, end: 67647 },
  // Cypriot Syllabary
  { begin: 68096, end: 68191 },
  // Kharoshthi
  { begin: 119552, end: 119647 },
  // Tai Xuan Jing Symbols
  { begin: 73728, end: 74751 },
  // Cuneiform
  { begin: 119648, end: 119679 },
  // Counting Rod Numerals
  { begin: 7040, end: 7103 },
  // Sundanese
  { begin: 7168, end: 7247 },
  // Lepcha
  { begin: 7248, end: 7295 },
  // Ol Chiki
  { begin: 43136, end: 43231 },
  // Saurashtra
  { begin: 43264, end: 43311 },
  // Kayah Li
  { begin: 43312, end: 43359 },
  // Rejang
  { begin: 43520, end: 43615 },
  // Cham
  { begin: 65936, end: 65999 },
  // Ancient Symbols
  { begin: 66e3, end: 66047 },
  // Phaistos Disc
  { begin: 66208, end: 66271 },
  // Carian
  { begin: 127024, end: 127135 }
  // Domino Tiles
];
function getUnicodeRange(unicode) {
  for (var i = 0; i < unicodeRanges.length; i += 1) {
    var range = unicodeRanges[i];
    if (unicode >= range.begin && unicode < range.end) {
      return i;
    }
  }
  return -1;
}
function parseOS2Table(data, start) {
  var os22 = {};
  var p = new parse.Parser(data, start);
  os22.version = p.parseUShort();
  os22.xAvgCharWidth = p.parseShort();
  os22.usWeightClass = p.parseUShort();
  os22.usWidthClass = p.parseUShort();
  os22.fsType = p.parseUShort();
  os22.ySubscriptXSize = p.parseShort();
  os22.ySubscriptYSize = p.parseShort();
  os22.ySubscriptXOffset = p.parseShort();
  os22.ySubscriptYOffset = p.parseShort();
  os22.ySuperscriptXSize = p.parseShort();
  os22.ySuperscriptYSize = p.parseShort();
  os22.ySuperscriptXOffset = p.parseShort();
  os22.ySuperscriptYOffset = p.parseShort();
  os22.yStrikeoutSize = p.parseShort();
  os22.yStrikeoutPosition = p.parseShort();
  os22.sFamilyClass = p.parseShort();
  os22.panose = [];
  for (var i = 0; i < 10; i++) {
    os22.panose[i] = p.parseByte();
  }
  os22.ulUnicodeRange1 = p.parseULong();
  os22.ulUnicodeRange2 = p.parseULong();
  os22.ulUnicodeRange3 = p.parseULong();
  os22.ulUnicodeRange4 = p.parseULong();
  os22.achVendID = String.fromCharCode(p.parseByte(), p.parseByte(), p.parseByte(), p.parseByte());
  os22.fsSelection = p.parseUShort();
  os22.usFirstCharIndex = p.parseUShort();
  os22.usLastCharIndex = p.parseUShort();
  os22.sTypoAscender = p.parseShort();
  os22.sTypoDescender = p.parseShort();
  os22.sTypoLineGap = p.parseShort();
  os22.usWinAscent = p.parseUShort();
  os22.usWinDescent = p.parseUShort();
  if (os22.version >= 1) {
    os22.ulCodePageRange1 = p.parseULong();
    os22.ulCodePageRange2 = p.parseULong();
  }
  if (os22.version >= 2) {
    os22.sxHeight = p.parseShort();
    os22.sCapHeight = p.parseShort();
    os22.usDefaultChar = p.parseUShort();
    os22.usBreakChar = p.parseUShort();
    os22.usMaxContent = p.parseUShort();
  }
  return os22;
}
function makeOS2Table(options) {
  return new table.Table("OS/2", [
    { name: "version", type: "USHORT", value: 3 },
    { name: "xAvgCharWidth", type: "SHORT", value: 0 },
    { name: "usWeightClass", type: "USHORT", value: 0 },
    { name: "usWidthClass", type: "USHORT", value: 0 },
    { name: "fsType", type: "USHORT", value: 0 },
    { name: "ySubscriptXSize", type: "SHORT", value: 650 },
    { name: "ySubscriptYSize", type: "SHORT", value: 699 },
    { name: "ySubscriptXOffset", type: "SHORT", value: 0 },
    { name: "ySubscriptYOffset", type: "SHORT", value: 140 },
    { name: "ySuperscriptXSize", type: "SHORT", value: 650 },
    { name: "ySuperscriptYSize", type: "SHORT", value: 699 },
    { name: "ySuperscriptXOffset", type: "SHORT", value: 0 },
    { name: "ySuperscriptYOffset", type: "SHORT", value: 479 },
    { name: "yStrikeoutSize", type: "SHORT", value: 49 },
    { name: "yStrikeoutPosition", type: "SHORT", value: 258 },
    { name: "sFamilyClass", type: "SHORT", value: 0 },
    { name: "bFamilyType", type: "BYTE", value: 0 },
    { name: "bSerifStyle", type: "BYTE", value: 0 },
    { name: "bWeight", type: "BYTE", value: 0 },
    { name: "bProportion", type: "BYTE", value: 0 },
    { name: "bContrast", type: "BYTE", value: 0 },
    { name: "bStrokeVariation", type: "BYTE", value: 0 },
    { name: "bArmStyle", type: "BYTE", value: 0 },
    { name: "bLetterform", type: "BYTE", value: 0 },
    { name: "bMidline", type: "BYTE", value: 0 },
    { name: "bXHeight", type: "BYTE", value: 0 },
    { name: "ulUnicodeRange1", type: "ULONG", value: 0 },
    { name: "ulUnicodeRange2", type: "ULONG", value: 0 },
    { name: "ulUnicodeRange3", type: "ULONG", value: 0 },
    { name: "ulUnicodeRange4", type: "ULONG", value: 0 },
    { name: "achVendID", type: "CHARARRAY", value: "XXXX" },
    { name: "fsSelection", type: "USHORT", value: 0 },
    { name: "usFirstCharIndex", type: "USHORT", value: 0 },
    { name: "usLastCharIndex", type: "USHORT", value: 0 },
    { name: "sTypoAscender", type: "SHORT", value: 0 },
    { name: "sTypoDescender", type: "SHORT", value: 0 },
    { name: "sTypoLineGap", type: "SHORT", value: 0 },
    { name: "usWinAscent", type: "USHORT", value: 0 },
    { name: "usWinDescent", type: "USHORT", value: 0 },
    { name: "ulCodePageRange1", type: "ULONG", value: 0 },
    { name: "ulCodePageRange2", type: "ULONG", value: 0 },
    { name: "sxHeight", type: "SHORT", value: 0 },
    { name: "sCapHeight", type: "SHORT", value: 0 },
    { name: "usDefaultChar", type: "USHORT", value: 0 },
    { name: "usBreakChar", type: "USHORT", value: 0 },
    { name: "usMaxContext", type: "USHORT", value: 0 }
  ], options);
}
var os2 = { parse: parseOS2Table, make: makeOS2Table, unicodeRanges, getUnicodeRange };
function parsePostTable(data, start) {
  var post2 = {};
  var p = new parse.Parser(data, start);
  post2.version = p.parseVersion();
  post2.italicAngle = p.parseFixed();
  post2.underlinePosition = p.parseShort();
  post2.underlineThickness = p.parseShort();
  post2.isFixedPitch = p.parseULong();
  post2.minMemType42 = p.parseULong();
  post2.maxMemType42 = p.parseULong();
  post2.minMemType1 = p.parseULong();
  post2.maxMemType1 = p.parseULong();
  switch (post2.version) {
    case 1:
      post2.names = standardNames.slice();
      break;
    case 2:
      post2.numberOfGlyphs = p.parseUShort();
      post2.glyphNameIndex = new Array(post2.numberOfGlyphs);
      for (var i = 0; i < post2.numberOfGlyphs; i++) {
        post2.glyphNameIndex[i] = p.parseUShort();
      }
      post2.names = [];
      for (var i$1 = 0; i$1 < post2.numberOfGlyphs; i$1++) {
        if (post2.glyphNameIndex[i$1] >= standardNames.length) {
          var nameLength = p.parseChar();
          post2.names.push(p.parseString(nameLength));
        }
      }
      break;
    case 2.5:
      post2.numberOfGlyphs = p.parseUShort();
      post2.offset = new Array(post2.numberOfGlyphs);
      for (var i$2 = 0; i$2 < post2.numberOfGlyphs; i$2++) {
        post2.offset[i$2] = p.parseChar();
      }
      break;
  }
  return post2;
}
function makePostTable() {
  return new table.Table("post", [
    { name: "version", type: "FIXED", value: 196608 },
    { name: "italicAngle", type: "FIXED", value: 0 },
    { name: "underlinePosition", type: "FWORD", value: 0 },
    { name: "underlineThickness", type: "FWORD", value: 0 },
    { name: "isFixedPitch", type: "ULONG", value: 0 },
    { name: "minMemType42", type: "ULONG", value: 0 },
    { name: "maxMemType42", type: "ULONG", value: 0 },
    { name: "minMemType1", type: "ULONG", value: 0 },
    { name: "maxMemType1", type: "ULONG", value: 0 }
  ]);
}
var post = { parse: parsePostTable, make: makePostTable };
var subtableParsers = new Array(9);
subtableParsers[1] = function parseLookup1() {
  var start = this.offset + this.relativeOffset;
  var substFormat = this.parseUShort();
  if (substFormat === 1) {
    return {
      substFormat: 1,
      coverage: this.parsePointer(Parser.coverage),
      deltaGlyphId: this.parseUShort()
    };
  } else if (substFormat === 2) {
    return {
      substFormat: 2,
      coverage: this.parsePointer(Parser.coverage),
      substitute: this.parseOffset16List()
    };
  }
  check.assert(false, "0x" + start.toString(16) + ": lookup type 1 format must be 1 or 2.");
};
subtableParsers[2] = function parseLookup2() {
  var substFormat = this.parseUShort();
  check.argument(substFormat === 1, "GSUB Multiple Substitution Subtable identifier-format must be 1");
  return {
    substFormat,
    coverage: this.parsePointer(Parser.coverage),
    sequences: this.parseListOfLists()
  };
};
subtableParsers[3] = function parseLookup3() {
  var substFormat = this.parseUShort();
  check.argument(substFormat === 1, "GSUB Alternate Substitution Subtable identifier-format must be 1");
  return {
    substFormat,
    coverage: this.parsePointer(Parser.coverage),
    alternateSets: this.parseListOfLists()
  };
};
subtableParsers[4] = function parseLookup4() {
  var substFormat = this.parseUShort();
  check.argument(substFormat === 1, "GSUB ligature table identifier-format must be 1");
  return {
    substFormat,
    coverage: this.parsePointer(Parser.coverage),
    ligatureSets: this.parseListOfLists(function() {
      return {
        ligGlyph: this.parseUShort(),
        components: this.parseUShortList(this.parseUShort() - 1)
      };
    })
  };
};
var lookupRecordDesc = {
  sequenceIndex: Parser.uShort,
  lookupListIndex: Parser.uShort
};
subtableParsers[5] = function parseLookup5() {
  var start = this.offset + this.relativeOffset;
  var substFormat = this.parseUShort();
  if (substFormat === 1) {
    return {
      substFormat,
      coverage: this.parsePointer(Parser.coverage),
      ruleSets: this.parseListOfLists(function() {
        var glyphCount2 = this.parseUShort();
        var substCount2 = this.parseUShort();
        return {
          input: this.parseUShortList(glyphCount2 - 1),
          lookupRecords: this.parseRecordList(substCount2, lookupRecordDesc)
        };
      })
    };
  } else if (substFormat === 2) {
    return {
      substFormat,
      coverage: this.parsePointer(Parser.coverage),
      classDef: this.parsePointer(Parser.classDef),
      classSets: this.parseListOfLists(function() {
        var glyphCount2 = this.parseUShort();
        var substCount2 = this.parseUShort();
        return {
          classes: this.parseUShortList(glyphCount2 - 1),
          lookupRecords: this.parseRecordList(substCount2, lookupRecordDesc)
        };
      })
    };
  } else if (substFormat === 3) {
    var glyphCount = this.parseUShort();
    var substCount = this.parseUShort();
    return {
      substFormat,
      coverages: this.parseList(glyphCount, Parser.pointer(Parser.coverage)),
      lookupRecords: this.parseRecordList(substCount, lookupRecordDesc)
    };
  }
  check.assert(false, "0x" + start.toString(16) + ": lookup type 5 format must be 1, 2 or 3.");
};
subtableParsers[6] = function parseLookup6() {
  var start = this.offset + this.relativeOffset;
  var substFormat = this.parseUShort();
  if (substFormat === 1) {
    return {
      substFormat: 1,
      coverage: this.parsePointer(Parser.coverage),
      chainRuleSets: this.parseListOfLists(function() {
        return {
          backtrack: this.parseUShortList(),
          input: this.parseUShortList(this.parseShort() - 1),
          lookahead: this.parseUShortList(),
          lookupRecords: this.parseRecordList(lookupRecordDesc)
        };
      })
    };
  } else if (substFormat === 2) {
    return {
      substFormat: 2,
      coverage: this.parsePointer(Parser.coverage),
      backtrackClassDef: this.parsePointer(Parser.classDef),
      inputClassDef: this.parsePointer(Parser.classDef),
      lookaheadClassDef: this.parsePointer(Parser.classDef),
      chainClassSet: this.parseListOfLists(function() {
        return {
          backtrack: this.parseUShortList(),
          input: this.parseUShortList(this.parseShort() - 1),
          lookahead: this.parseUShortList(),
          lookupRecords: this.parseRecordList(lookupRecordDesc)
        };
      })
    };
  } else if (substFormat === 3) {
    return {
      substFormat: 3,
      backtrackCoverage: this.parseList(Parser.pointer(Parser.coverage)),
      inputCoverage: this.parseList(Parser.pointer(Parser.coverage)),
      lookaheadCoverage: this.parseList(Parser.pointer(Parser.coverage)),
      lookupRecords: this.parseRecordList(lookupRecordDesc)
    };
  }
  check.assert(false, "0x" + start.toString(16) + ": lookup type 6 format must be 1, 2 or 3.");
};
subtableParsers[7] = function parseLookup7() {
  var substFormat = this.parseUShort();
  check.argument(substFormat === 1, "GSUB Extension Substitution subtable identifier-format must be 1");
  var extensionLookupType = this.parseUShort();
  var extensionParser = new Parser(this.data, this.offset + this.parseULong());
  return {
    substFormat: 1,
    lookupType: extensionLookupType,
    extension: subtableParsers[extensionLookupType].call(extensionParser)
  };
};
subtableParsers[8] = function parseLookup8() {
  var substFormat = this.parseUShort();
  check.argument(substFormat === 1, "GSUB Reverse Chaining Contextual Single Substitution Subtable identifier-format must be 1");
  return {
    substFormat,
    coverage: this.parsePointer(Parser.coverage),
    backtrackCoverage: this.parseList(Parser.pointer(Parser.coverage)),
    lookaheadCoverage: this.parseList(Parser.pointer(Parser.coverage)),
    substitutes: this.parseUShortList()
  };
};
function parseGsubTable(data, start) {
  start = start || 0;
  var p = new Parser(data, start);
  var tableVersion = p.parseVersion(1);
  check.argument(tableVersion === 1 || tableVersion === 1.1, "Unsupported GSUB table version.");
  if (tableVersion === 1) {
    return {
      version: tableVersion,
      scripts: p.parseScriptList(),
      features: p.parseFeatureList(),
      lookups: p.parseLookupList(subtableParsers)
    };
  } else {
    return {
      version: tableVersion,
      scripts: p.parseScriptList(),
      features: p.parseFeatureList(),
      lookups: p.parseLookupList(subtableParsers),
      variations: p.parseFeatureVariationsList()
    };
  }
}
var subtableMakers = new Array(9);
subtableMakers[1] = function makeLookup1(subtable) {
  if (subtable.substFormat === 1) {
    return new table.Table("substitutionTable", [
      { name: "substFormat", type: "USHORT", value: 1 },
      { name: "coverage", type: "TABLE", value: new table.Coverage(subtable.coverage) },
      { name: "deltaGlyphID", type: "USHORT", value: subtable.deltaGlyphId }
    ]);
  } else {
    return new table.Table("substitutionTable", [
      { name: "substFormat", type: "USHORT", value: 2 },
      { name: "coverage", type: "TABLE", value: new table.Coverage(subtable.coverage) }
    ].concat(table.ushortList("substitute", subtable.substitute)));
  }
};
subtableMakers[2] = function makeLookup2(subtable) {
  check.assert(subtable.substFormat === 1, "Lookup type 2 substFormat must be 1.");
  return new table.Table("substitutionTable", [
    { name: "substFormat", type: "USHORT", value: 1 },
    { name: "coverage", type: "TABLE", value: new table.Coverage(subtable.coverage) }
  ].concat(table.tableList("seqSet", subtable.sequences, function(sequenceSet) {
    return new table.Table("sequenceSetTable", table.ushortList("sequence", sequenceSet));
  })));
};
subtableMakers[3] = function makeLookup3(subtable) {
  check.assert(subtable.substFormat === 1, "Lookup type 3 substFormat must be 1.");
  return new table.Table("substitutionTable", [
    { name: "substFormat", type: "USHORT", value: 1 },
    { name: "coverage", type: "TABLE", value: new table.Coverage(subtable.coverage) }
  ].concat(table.tableList("altSet", subtable.alternateSets, function(alternateSet) {
    return new table.Table("alternateSetTable", table.ushortList("alternate", alternateSet));
  })));
};
subtableMakers[4] = function makeLookup4(subtable) {
  check.assert(subtable.substFormat === 1, "Lookup type 4 substFormat must be 1.");
  return new table.Table("substitutionTable", [
    { name: "substFormat", type: "USHORT", value: 1 },
    { name: "coverage", type: "TABLE", value: new table.Coverage(subtable.coverage) }
  ].concat(table.tableList("ligSet", subtable.ligatureSets, function(ligatureSet) {
    return new table.Table("ligatureSetTable", table.tableList("ligature", ligatureSet, function(ligature) {
      return new table.Table(
        "ligatureTable",
        [{ name: "ligGlyph", type: "USHORT", value: ligature.ligGlyph }].concat(table.ushortList("component", ligature.components, ligature.components.length + 1))
      );
    }));
  })));
};
subtableMakers[6] = function makeLookup6(subtable) {
  if (subtable.substFormat === 1) {
    var returnTable = new table.Table("chainContextTable", [
      { name: "substFormat", type: "USHORT", value: subtable.substFormat },
      { name: "coverage", type: "TABLE", value: new table.Coverage(subtable.coverage) }
    ].concat(table.tableList("chainRuleSet", subtable.chainRuleSets, function(chainRuleSet) {
      return new table.Table("chainRuleSetTable", table.tableList("chainRule", chainRuleSet, function(chainRule) {
        var tableData2 = table.ushortList("backtrackGlyph", chainRule.backtrack, chainRule.backtrack.length).concat(table.ushortList("inputGlyph", chainRule.input, chainRule.input.length + 1)).concat(table.ushortList("lookaheadGlyph", chainRule.lookahead, chainRule.lookahead.length)).concat(table.ushortList("substitution", [], chainRule.lookupRecords.length));
        chainRule.lookupRecords.forEach(function(record, i) {
          tableData2 = tableData2.concat({ name: "sequenceIndex" + i, type: "USHORT", value: record.sequenceIndex }).concat({ name: "lookupListIndex" + i, type: "USHORT", value: record.lookupListIndex });
        });
        return new table.Table("chainRuleTable", tableData2);
      }));
    })));
    return returnTable;
  } else if (subtable.substFormat === 2) {
    check.assert(false, "lookup type 6 format 2 is not yet supported.");
  } else if (subtable.substFormat === 3) {
    var tableData = [
      { name: "substFormat", type: "USHORT", value: subtable.substFormat }
    ];
    tableData.push({ name: "backtrackGlyphCount", type: "USHORT", value: subtable.backtrackCoverage.length });
    subtable.backtrackCoverage.forEach(function(coverage, i) {
      tableData.push({ name: "backtrackCoverage" + i, type: "TABLE", value: new table.Coverage(coverage) });
    });
    tableData.push({ name: "inputGlyphCount", type: "USHORT", value: subtable.inputCoverage.length });
    subtable.inputCoverage.forEach(function(coverage, i) {
      tableData.push({ name: "inputCoverage" + i, type: "TABLE", value: new table.Coverage(coverage) });
    });
    tableData.push({ name: "lookaheadGlyphCount", type: "USHORT", value: subtable.lookaheadCoverage.length });
    subtable.lookaheadCoverage.forEach(function(coverage, i) {
      tableData.push({ name: "lookaheadCoverage" + i, type: "TABLE", value: new table.Coverage(coverage) });
    });
    tableData.push({ name: "substitutionCount", type: "USHORT", value: subtable.lookupRecords.length });
    subtable.lookupRecords.forEach(function(record, i) {
      tableData = tableData.concat({ name: "sequenceIndex" + i, type: "USHORT", value: record.sequenceIndex }).concat({ name: "lookupListIndex" + i, type: "USHORT", value: record.lookupListIndex });
    });
    var returnTable$1 = new table.Table("chainContextTable", tableData);
    return returnTable$1;
  }
  check.assert(false, "lookup type 6 format must be 1, 2 or 3.");
};
function makeGsubTable(gsub2) {
  return new table.Table("GSUB", [
    { name: "version", type: "ULONG", value: 65536 },
    { name: "scripts", type: "TABLE", value: new table.ScriptList(gsub2.scripts) },
    { name: "features", type: "TABLE", value: new table.FeatureList(gsub2.features) },
    { name: "lookups", type: "TABLE", value: new table.LookupList(gsub2.lookups, subtableMakers) }
  ]);
}
var gsub = { parse: parseGsubTable, make: makeGsubTable };
function parseMetaTable(data, start) {
  var p = new parse.Parser(data, start);
  var tableVersion = p.parseULong();
  check.argument(tableVersion === 1, "Unsupported META table version.");
  p.parseULong();
  p.parseULong();
  var numDataMaps = p.parseULong();
  var tags = {};
  for (var i = 0; i < numDataMaps; i++) {
    var tag = p.parseTag();
    var dataOffset = p.parseULong();
    var dataLength = p.parseULong();
    var text = decode.UTF8(data, start + dataOffset, dataLength);
    tags[tag] = text;
  }
  return tags;
}
function makeMetaTable(tags) {
  var numTags = Object.keys(tags).length;
  var stringPool = "";
  var stringPoolOffset = 16 + numTags * 12;
  var result = new table.Table("meta", [
    { name: "version", type: "ULONG", value: 1 },
    { name: "flags", type: "ULONG", value: 0 },
    { name: "offset", type: "ULONG", value: stringPoolOffset },
    { name: "numTags", type: "ULONG", value: numTags }
  ]);
  for (var tag in tags) {
    var pos = stringPool.length;
    stringPool += tags[tag];
    result.fields.push({ name: "tag " + tag, type: "TAG", value: tag });
    result.fields.push({ name: "offset " + tag, type: "ULONG", value: stringPoolOffset + pos });
    result.fields.push({ name: "length " + tag, type: "ULONG", value: tags[tag].length });
  }
  result.fields.push({ name: "stringPool", type: "CHARARRAY", value: stringPool });
  return result;
}
var meta = { parse: parseMetaTable, make: makeMetaTable };
function log2(v) {
  return Math.log(v) / Math.log(2) | 0;
}
function computeCheckSum(bytes) {
  while (bytes.length % 4 !== 0) {
    bytes.push(0);
  }
  var sum = 0;
  for (var i = 0; i < bytes.length; i += 4) {
    sum += (bytes[i] << 24) + (bytes[i + 1] << 16) + (bytes[i + 2] << 8) + bytes[i + 3];
  }
  sum %= Math.pow(2, 32);
  return sum;
}
function makeTableRecord(tag, checkSum, offset, length) {
  return new table.Record("Table Record", [
    { name: "tag", type: "TAG", value: tag !== void 0 ? tag : "" },
    { name: "checkSum", type: "ULONG", value: checkSum !== void 0 ? checkSum : 0 },
    { name: "offset", type: "ULONG", value: offset !== void 0 ? offset : 0 },
    { name: "length", type: "ULONG", value: length !== void 0 ? length : 0 }
  ]);
}
function makeSfntTable(tables) {
  var sfnt2 = new table.Table("sfnt", [
    { name: "version", type: "TAG", value: "OTTO" },
    { name: "numTables", type: "USHORT", value: 0 },
    { name: "searchRange", type: "USHORT", value: 0 },
    { name: "entrySelector", type: "USHORT", value: 0 },
    { name: "rangeShift", type: "USHORT", value: 0 }
  ]);
  sfnt2.tables = tables;
  sfnt2.numTables = tables.length;
  var highestPowerOf2 = Math.pow(2, log2(sfnt2.numTables));
  sfnt2.searchRange = 16 * highestPowerOf2;
  sfnt2.entrySelector = log2(highestPowerOf2);
  sfnt2.rangeShift = sfnt2.numTables * 16 - sfnt2.searchRange;
  var recordFields = [];
  var tableFields = [];
  var offset = sfnt2.sizeOf() + makeTableRecord().sizeOf() * sfnt2.numTables;
  while (offset % 4 !== 0) {
    offset += 1;
    tableFields.push({ name: "padding", type: "BYTE", value: 0 });
  }
  for (var i = 0; i < tables.length; i += 1) {
    var t = tables[i];
    check.argument(t.tableName.length === 4, "Table name" + t.tableName + " is invalid.");
    var tableLength = t.sizeOf();
    var tableRecord = makeTableRecord(t.tableName, computeCheckSum(t.encode()), offset, tableLength);
    recordFields.push({ name: tableRecord.tag + " Table Record", type: "RECORD", value: tableRecord });
    tableFields.push({ name: t.tableName + " table", type: "RECORD", value: t });
    offset += tableLength;
    check.argument(!isNaN(offset), "Something went wrong calculating the offset.");
    while (offset % 4 !== 0) {
      offset += 1;
      tableFields.push({ name: "padding", type: "BYTE", value: 0 });
    }
  }
  recordFields.sort(function(r1, r2) {
    if (r1.value.tag > r2.value.tag) {
      return 1;
    } else {
      return -1;
    }
  });
  sfnt2.fields = sfnt2.fields.concat(recordFields);
  sfnt2.fields = sfnt2.fields.concat(tableFields);
  return sfnt2;
}
function metricsForChar(font, chars, notFoundMetrics) {
  for (var i = 0; i < chars.length; i += 1) {
    var glyphIndex = font.charToGlyphIndex(chars[i]);
    if (glyphIndex > 0) {
      var glyph = font.glyphs.get(glyphIndex);
      return glyph.getMetrics();
    }
  }
  return notFoundMetrics;
}
function average(vs) {
  var sum = 0;
  for (var i = 0; i < vs.length; i += 1) {
    sum += vs[i];
  }
  return sum / vs.length;
}
function fontToSfntTable(font) {
  var xMins = [];
  var yMins = [];
  var xMaxs = [];
  var yMaxs = [];
  var advanceWidths = [];
  var leftSideBearings = [];
  var rightSideBearings = [];
  var firstCharIndex;
  var lastCharIndex = 0;
  var ulUnicodeRange1 = 0;
  var ulUnicodeRange2 = 0;
  var ulUnicodeRange3 = 0;
  var ulUnicodeRange4 = 0;
  for (var i = 0; i < font.glyphs.length; i += 1) {
    var glyph = font.glyphs.get(i);
    var unicode = glyph.unicode | 0;
    if (isNaN(glyph.advanceWidth)) {
      throw new Error("Glyph " + glyph.name + " (" + i + "): advanceWidth is not a number.");
    }
    if (firstCharIndex > unicode || firstCharIndex === void 0) {
      if (unicode > 0) {
        firstCharIndex = unicode;
      }
    }
    if (lastCharIndex < unicode) {
      lastCharIndex = unicode;
    }
    var position = os2.getUnicodeRange(unicode);
    if (position < 32) {
      ulUnicodeRange1 |= 1 << position;
    } else if (position < 64) {
      ulUnicodeRange2 |= 1 << position - 32;
    } else if (position < 96) {
      ulUnicodeRange3 |= 1 << position - 64;
    } else if (position < 123) {
      ulUnicodeRange4 |= 1 << position - 96;
    } else {
      throw new Error("Unicode ranges bits > 123 are reserved for internal usage");
    }
    if (glyph.name === ".notdef") {
      continue;
    }
    var metrics = glyph.getMetrics();
    xMins.push(metrics.xMin);
    yMins.push(metrics.yMin);
    xMaxs.push(metrics.xMax);
    yMaxs.push(metrics.yMax);
    leftSideBearings.push(metrics.leftSideBearing);
    rightSideBearings.push(metrics.rightSideBearing);
    advanceWidths.push(glyph.advanceWidth);
  }
  var globals = {
    xMin: Math.min.apply(null, xMins),
    yMin: Math.min.apply(null, yMins),
    xMax: Math.max.apply(null, xMaxs),
    yMax: Math.max.apply(null, yMaxs),
    advanceWidthMax: Math.max.apply(null, advanceWidths),
    advanceWidthAvg: average(advanceWidths),
    minLeftSideBearing: Math.min.apply(null, leftSideBearings),
    maxLeftSideBearing: Math.max.apply(null, leftSideBearings),
    minRightSideBearing: Math.min.apply(null, rightSideBearings)
  };
  globals.ascender = font.ascender;
  globals.descender = font.descender;
  var headTable = head.make({
    flags: 3,
    // 00000011 (baseline for font at y=0; left sidebearing point at x=0)
    unitsPerEm: font.unitsPerEm,
    xMin: globals.xMin,
    yMin: globals.yMin,
    xMax: globals.xMax,
    yMax: globals.yMax,
    lowestRecPPEM: 3,
    createdTimestamp: font.createdTimestamp
  });
  var hheaTable = hhea.make({
    ascender: globals.ascender,
    descender: globals.descender,
    advanceWidthMax: globals.advanceWidthMax,
    minLeftSideBearing: globals.minLeftSideBearing,
    minRightSideBearing: globals.minRightSideBearing,
    xMaxExtent: globals.maxLeftSideBearing + (globals.xMax - globals.xMin),
    numberOfHMetrics: font.glyphs.length
  });
  var maxpTable = maxp.make(font.glyphs.length);
  var os2Table = os2.make(Object.assign({
    xAvgCharWidth: Math.round(globals.advanceWidthAvg),
    usFirstCharIndex: firstCharIndex,
    usLastCharIndex: lastCharIndex,
    ulUnicodeRange1,
    ulUnicodeRange2,
    ulUnicodeRange3,
    ulUnicodeRange4,
    // See http://typophile.com/node/13081 for more info on vertical metrics.
    // We get metrics for typical characters (such as "x" for xHeight).
    // We provide some fallback characters if characters are unavailable: their
    // ordering was chosen experimentally.
    sTypoAscender: globals.ascender,
    sTypoDescender: globals.descender,
    sTypoLineGap: 0,
    usWinAscent: globals.yMax,
    usWinDescent: Math.abs(globals.yMin),
    ulCodePageRange1: 1,
    // FIXME: hard-code Latin 1 support for now
    sxHeight: metricsForChar(font, "xyvw", { yMax: Math.round(globals.ascender / 2) }).yMax,
    sCapHeight: metricsForChar(font, "HIKLEFJMNTZBDPRAGOQSUVWXY", globals).yMax,
    usDefaultChar: font.hasChar(" ") ? 32 : 0,
    // Use space as the default character, if available.
    usBreakChar: font.hasChar(" ") ? 32 : 0
    // Use space as the break character, if available.
  }, font.tables.os2));
  var hmtxTable = hmtx.make(font.glyphs);
  var cmapTable = cmap.make(font.glyphs);
  var englishFamilyName = font.getEnglishName("fontFamily");
  var englishStyleName = font.getEnglishName("fontSubfamily");
  var englishFullName = englishFamilyName + " " + englishStyleName;
  var postScriptName = font.getEnglishName("postScriptName");
  if (!postScriptName) {
    postScriptName = englishFamilyName.replace(/\s/g, "") + "-" + englishStyleName;
  }
  var names = {};
  for (var n in font.names) {
    names[n] = font.names[n];
  }
  if (!names.uniqueID) {
    names.uniqueID = { en: font.getEnglishName("manufacturer") + ":" + englishFullName };
  }
  if (!names.postScriptName) {
    names.postScriptName = { en: postScriptName };
  }
  if (!names.preferredFamily) {
    names.preferredFamily = font.names.fontFamily;
  }
  if (!names.preferredSubfamily) {
    names.preferredSubfamily = font.names.fontSubfamily;
  }
  var languageTags = [];
  var nameTable = _name.make(names, languageTags);
  var ltagTable = languageTags.length > 0 ? ltag.make(languageTags) : void 0;
  var postTable = post.make();
  var cffTable = cff.make(font.glyphs, {
    version: font.getEnglishName("version"),
    fullName: englishFullName,
    familyName: englishFamilyName,
    weightName: englishStyleName,
    postScriptName,
    unitsPerEm: font.unitsPerEm,
    fontBBox: [0, globals.yMin, globals.ascender, globals.advanceWidthMax]
  });
  var metaTable = font.metas && Object.keys(font.metas).length > 0 ? meta.make(font.metas) : void 0;
  var tables = [headTable, hheaTable, maxpTable, os2Table, nameTable, cmapTable, postTable, cffTable, hmtxTable];
  if (ltagTable) {
    tables.push(ltagTable);
  }
  if (font.tables.gsub) {
    tables.push(gsub.make(font.tables.gsub));
  }
  if (metaTable) {
    tables.push(metaTable);
  }
  var sfntTable = makeSfntTable(tables);
  var bytes = sfntTable.encode();
  var checkSum = computeCheckSum(bytes);
  var tableFields = sfntTable.fields;
  var checkSumAdjusted = false;
  for (var i$1 = 0; i$1 < tableFields.length; i$1 += 1) {
    if (tableFields[i$1].name === "head table") {
      tableFields[i$1].value.checkSumAdjustment = 2981146554 - checkSum;
      checkSumAdjusted = true;
      break;
    }
  }
  if (!checkSumAdjusted) {
    throw new Error("Could not find head table with checkSum to adjust.");
  }
  return sfntTable;
}
var sfnt = { make: makeSfntTable, fontToTable: fontToSfntTable, computeCheckSum };
function searchTag(arr, tag) {
  var imin = 0;
  var imax = arr.length - 1;
  while (imin <= imax) {
    var imid = imin + imax >>> 1;
    var val = arr[imid].tag;
    if (val === tag) {
      return imid;
    } else if (val < tag) {
      imin = imid + 1;
    } else {
      imax = imid - 1;
    }
  }
  return -imin - 1;
}
function binSearch(arr, value) {
  var imin = 0;
  var imax = arr.length - 1;
  while (imin <= imax) {
    var imid = imin + imax >>> 1;
    var val = arr[imid];
    if (val === value) {
      return imid;
    } else if (val < value) {
      imin = imid + 1;
    } else {
      imax = imid - 1;
    }
  }
  return -imin - 1;
}
function searchRange(ranges, value) {
  var range;
  var imin = 0;
  var imax = ranges.length - 1;
  while (imin <= imax) {
    var imid = imin + imax >>> 1;
    range = ranges[imid];
    var start = range.start;
    if (start === value) {
      return range;
    } else if (start < value) {
      imin = imid + 1;
    } else {
      imax = imid - 1;
    }
  }
  if (imin > 0) {
    range = ranges[imin - 1];
    if (value > range.end) {
      return 0;
    }
    return range;
  }
}
function Layout(font, tableName) {
  this.font = font;
  this.tableName = tableName;
}
Layout.prototype = {
  /**
   * Binary search an object by "tag" property
   * @instance
   * @function searchTag
   * @memberof opentype.Layout
   * @param  {Array} arr
   * @param  {string} tag
   * @return {number}
   */
  searchTag,
  /**
   * Binary search in a list of numbers
   * @instance
   * @function binSearch
   * @memberof opentype.Layout
   * @param  {Array} arr
   * @param  {number} value
   * @return {number}
   */
  binSearch,
  /**
   * Get or create the Layout table (GSUB, GPOS etc).
   * @param  {boolean} create - Whether to create a new one.
   * @return {Object} The GSUB or GPOS table.
   */
  getTable: function(create) {
    var layout = this.font.tables[this.tableName];
    if (!layout && create) {
      layout = this.font.tables[this.tableName] = this.createDefaultTable();
    }
    return layout;
  },
  /**
   * Returns all scripts in the substitution table.
   * @instance
   * @return {Array}
   */
  getScriptNames: function() {
    var layout = this.getTable();
    if (!layout) {
      return [];
    }
    return layout.scripts.map(function(script) {
      return script.tag;
    });
  },
  /**
   * Returns the best bet for a script name.
   * Returns 'DFLT' if it exists.
   * If not, returns 'latn' if it exists.
   * If neither exist, returns undefined.
   */
  getDefaultScriptName: function() {
    var layout = this.getTable();
    if (!layout) {
      return;
    }
    var hasLatn = false;
    for (var i = 0; i < layout.scripts.length; i++) {
      var name = layout.scripts[i].tag;
      if (name === "DFLT") {
        return name;
      }
      if (name === "latn") {
        hasLatn = true;
      }
    }
    if (hasLatn) {
      return "latn";
    }
  },
  /**
   * Returns all LangSysRecords in the given script.
   * @instance
   * @param {string} [script='DFLT']
   * @param {boolean} create - forces the creation of this script table if it doesn't exist.
   * @return {Object} An object with tag and script properties.
   */
  getScriptTable: function(script, create) {
    var layout = this.getTable(create);
    if (layout) {
      script = script || "DFLT";
      var scripts = layout.scripts;
      var pos = searchTag(layout.scripts, script);
      if (pos >= 0) {
        return scripts[pos].script;
      } else if (create) {
        var scr = {
          tag: script,
          script: {
            defaultLangSys: { reserved: 0, reqFeatureIndex: 65535, featureIndexes: [] },
            langSysRecords: []
          }
        };
        scripts.splice(-1 - pos, 0, scr);
        return scr.script;
      }
    }
  },
  /**
   * Returns a language system table
   * @instance
   * @param {string} [script='DFLT']
   * @param {string} [language='dlft']
   * @param {boolean} create - forces the creation of this langSysTable if it doesn't exist.
   * @return {Object}
   */
  getLangSysTable: function(script, language, create) {
    var scriptTable = this.getScriptTable(script, create);
    if (scriptTable) {
      if (!language || language === "dflt" || language === "DFLT") {
        return scriptTable.defaultLangSys;
      }
      var pos = searchTag(scriptTable.langSysRecords, language);
      if (pos >= 0) {
        return scriptTable.langSysRecords[pos].langSys;
      } else if (create) {
        var langSysRecord = {
          tag: language,
          langSys: { reserved: 0, reqFeatureIndex: 65535, featureIndexes: [] }
        };
        scriptTable.langSysRecords.splice(-1 - pos, 0, langSysRecord);
        return langSysRecord.langSys;
      }
    }
  },
  /**
   * Get a specific feature table.
   * @instance
   * @param {string} [script='DFLT']
   * @param {string} [language='dlft']
   * @param {string} feature - One of the codes listed at https://www.microsoft.com/typography/OTSPEC/featurelist.htm
   * @param {boolean} create - forces the creation of the feature table if it doesn't exist.
   * @return {Object}
   */
  getFeatureTable: function(script, language, feature, create) {
    var langSysTable2 = this.getLangSysTable(script, language, create);
    if (langSysTable2) {
      var featureRecord;
      var featIndexes = langSysTable2.featureIndexes;
      var allFeatures = this.font.tables[this.tableName].features;
      for (var i = 0; i < featIndexes.length; i++) {
        featureRecord = allFeatures[featIndexes[i]];
        if (featureRecord.tag === feature) {
          return featureRecord.feature;
        }
      }
      if (create) {
        var index = allFeatures.length;
        check.assert(index === 0 || feature >= allFeatures[index - 1].tag, "Features must be added in alphabetical order.");
        featureRecord = {
          tag: feature,
          feature: { params: 0, lookupListIndexes: [] }
        };
        allFeatures.push(featureRecord);
        featIndexes.push(index);
        return featureRecord.feature;
      }
    }
  },
  /**
   * Get the lookup tables of a given type for a script/language/feature.
   * @instance
   * @param {string} [script='DFLT']
   * @param {string} [language='dlft']
   * @param {string} feature - 4-letter feature code
   * @param {number} lookupType - 1 to 9
   * @param {boolean} create - forces the creation of the lookup table if it doesn't exist, with no subtables.
   * @return {Object[]}
   */
  getLookupTables: function(script, language, feature, lookupType, create) {
    var featureTable = this.getFeatureTable(script, language, feature, create);
    var tables = [];
    if (featureTable) {
      var lookupTable;
      var lookupListIndexes = featureTable.lookupListIndexes;
      var allLookups = this.font.tables[this.tableName].lookups;
      for (var i = 0; i < lookupListIndexes.length; i++) {
        lookupTable = allLookups[lookupListIndexes[i]];
        if (lookupTable.lookupType === lookupType) {
          tables.push(lookupTable);
        }
      }
      if (tables.length === 0 && create) {
        lookupTable = {
          lookupType,
          lookupFlag: 0,
          subtables: [],
          markFilteringSet: void 0
        };
        var index = allLookups.length;
        allLookups.push(lookupTable);
        lookupListIndexes.push(index);
        return [lookupTable];
      }
    }
    return tables;
  },
  /**
   * Find a glyph in a class definition table
   * https://docs.microsoft.com/en-us/typography/opentype/spec/chapter2#class-definition-table
   * @param {object} classDefTable - an OpenType Layout class definition table
   * @param {number} glyphIndex - the index of the glyph to find
   * @returns {number} -1 if not found
   */
  getGlyphClass: function(classDefTable, glyphIndex) {
    switch (classDefTable.format) {
      case 1:
        if (classDefTable.startGlyph <= glyphIndex && glyphIndex < classDefTable.startGlyph + classDefTable.classes.length) {
          return classDefTable.classes[glyphIndex - classDefTable.startGlyph];
        }
        return 0;
      case 2:
        var range = searchRange(classDefTable.ranges, glyphIndex);
        return range ? range.classId : 0;
    }
  },
  /**
   * Find a glyph in a coverage table
   * https://docs.microsoft.com/en-us/typography/opentype/spec/chapter2#coverage-table
   * @param {object} coverageTable - an OpenType Layout coverage table
   * @param {number} glyphIndex - the index of the glyph to find
   * @returns {number} -1 if not found
   */
  getCoverageIndex: function(coverageTable, glyphIndex) {
    switch (coverageTable.format) {
      case 1:
        var index = binSearch(coverageTable.glyphs, glyphIndex);
        return index >= 0 ? index : -1;
      case 2:
        var range = searchRange(coverageTable.ranges, glyphIndex);
        return range ? range.index + glyphIndex - range.start : -1;
    }
  },
  /**
   * Returns the list of glyph indexes of a coverage table.
   * Format 1: the list is stored raw
   * Format 2: compact list as range records.
   * @instance
   * @param  {Object} coverageTable
   * @return {Array}
   */
  expandCoverage: function(coverageTable) {
    if (coverageTable.format === 1) {
      return coverageTable.glyphs;
    } else {
      var glyphs = [];
      var ranges = coverageTable.ranges;
      for (var i = 0; i < ranges.length; i++) {
        var range = ranges[i];
        var start = range.start;
        var end = range.end;
        for (var j = start; j <= end; j++) {
          glyphs.push(j);
        }
      }
      return glyphs;
    }
  }
};
function Position(font) {
  Layout.call(this, font, "gpos");
}
Position.prototype = Layout.prototype;
Position.prototype.init = function() {
  var script = this.getDefaultScriptName();
  this.defaultKerningTables = this.getKerningTables(script);
};
Position.prototype.getKerningValue = function(kerningLookups, leftIndex, rightIndex) {
  for (var i = 0; i < kerningLookups.length; i++) {
    var subtables = kerningLookups[i].subtables;
    for (var j = 0; j < subtables.length; j++) {
      var subtable = subtables[j];
      var covIndex = this.getCoverageIndex(subtable.coverage, leftIndex);
      if (covIndex < 0) {
        continue;
      }
      switch (subtable.posFormat) {
        case 1:
          var pairSet = subtable.pairSets[covIndex];
          for (var k = 0; k < pairSet.length; k++) {
            var pair = pairSet[k];
            if (pair.secondGlyph === rightIndex) {
              return pair.value1 && pair.value1.xAdvance || 0;
            }
          }
          break;
        // left glyph found, not right glyph - try next subtable
        case 2:
          var class1 = this.getGlyphClass(subtable.classDef1, leftIndex);
          var class2 = this.getGlyphClass(subtable.classDef2, rightIndex);
          var pair$1 = subtable.classRecords[class1][class2];
          return pair$1.value1 && pair$1.value1.xAdvance || 0;
      }
    }
  }
  return 0;
};
Position.prototype.getKerningTables = function(script, language) {
  if (this.font.tables.gpos) {
    return this.getLookupTables(script, language, "kern", 2);
  }
};
function Substitution(font) {
  Layout.call(this, font, "gsub");
}
function arraysEqual(ar1, ar2) {
  var n = ar1.length;
  if (n !== ar2.length) {
    return false;
  }
  for (var i = 0; i < n; i++) {
    if (ar1[i] !== ar2[i]) {
      return false;
    }
  }
  return true;
}
function getSubstFormat(lookupTable, format, defaultSubtable) {
  var subtables = lookupTable.subtables;
  for (var i = 0; i < subtables.length; i++) {
    var subtable = subtables[i];
    if (subtable.substFormat === format) {
      return subtable;
    }
  }
  if (defaultSubtable) {
    subtables.push(defaultSubtable);
    return defaultSubtable;
  }
  return void 0;
}
Substitution.prototype = Layout.prototype;
Substitution.prototype.createDefaultTable = function() {
  return {
    version: 1,
    scripts: [{
      tag: "DFLT",
      script: {
        defaultLangSys: { reserved: 0, reqFeatureIndex: 65535, featureIndexes: [] },
        langSysRecords: []
      }
    }],
    features: [],
    lookups: []
  };
};
Substitution.prototype.getSingle = function(feature, script, language) {
  var substitutions = [];
  var lookupTables = this.getLookupTables(script, language, feature, 1);
  for (var idx = 0; idx < lookupTables.length; idx++) {
    var subtables = lookupTables[idx].subtables;
    for (var i = 0; i < subtables.length; i++) {
      var subtable = subtables[i];
      var glyphs = this.expandCoverage(subtable.coverage);
      var j = void 0;
      if (subtable.substFormat === 1) {
        var delta = subtable.deltaGlyphId;
        for (j = 0; j < glyphs.length; j++) {
          var glyph = glyphs[j];
          substitutions.push({ sub: glyph, by: glyph + delta });
        }
      } else {
        var substitute = subtable.substitute;
        for (j = 0; j < glyphs.length; j++) {
          substitutions.push({ sub: glyphs[j], by: substitute[j] });
        }
      }
    }
  }
  return substitutions;
};
Substitution.prototype.getMultiple = function(feature, script, language) {
  var substitutions = [];
  var lookupTables = this.getLookupTables(script, language, feature, 2);
  for (var idx = 0; idx < lookupTables.length; idx++) {
    var subtables = lookupTables[idx].subtables;
    for (var i = 0; i < subtables.length; i++) {
      var subtable = subtables[i];
      var glyphs = this.expandCoverage(subtable.coverage);
      var j = void 0;
      for (j = 0; j < glyphs.length; j++) {
        var glyph = glyphs[j];
        var replacements = subtable.sequences[j];
        substitutions.push({ sub: glyph, by: replacements });
      }
    }
  }
  return substitutions;
};
Substitution.prototype.getAlternates = function(feature, script, language) {
  var alternates = [];
  var lookupTables = this.getLookupTables(script, language, feature, 3);
  for (var idx = 0; idx < lookupTables.length; idx++) {
    var subtables = lookupTables[idx].subtables;
    for (var i = 0; i < subtables.length; i++) {
      var subtable = subtables[i];
      var glyphs = this.expandCoverage(subtable.coverage);
      var alternateSets = subtable.alternateSets;
      for (var j = 0; j < glyphs.length; j++) {
        alternates.push({ sub: glyphs[j], by: alternateSets[j] });
      }
    }
  }
  return alternates;
};
Substitution.prototype.getLigatures = function(feature, script, language) {
  var ligatures = [];
  var lookupTables = this.getLookupTables(script, language, feature, 4);
  for (var idx = 0; idx < lookupTables.length; idx++) {
    var subtables = lookupTables[idx].subtables;
    for (var i = 0; i < subtables.length; i++) {
      var subtable = subtables[i];
      var glyphs = this.expandCoverage(subtable.coverage);
      var ligatureSets = subtable.ligatureSets;
      for (var j = 0; j < glyphs.length; j++) {
        var startGlyph = glyphs[j];
        var ligSet = ligatureSets[j];
        for (var k = 0; k < ligSet.length; k++) {
          var lig = ligSet[k];
          ligatures.push({
            sub: [startGlyph].concat(lig.components),
            by: lig.ligGlyph
          });
        }
      }
    }
  }
  return ligatures;
};
Substitution.prototype.addSingle = function(feature, substitution, script, language) {
  var lookupTable = this.getLookupTables(script, language, feature, 1, true)[0];
  var subtable = getSubstFormat(lookupTable, 2, {
    // lookup type 1 subtable, format 2, coverage format 1
    substFormat: 2,
    coverage: { format: 1, glyphs: [] },
    substitute: []
  });
  check.assert(subtable.coverage.format === 1, "Single: unable to modify coverage table format " + subtable.coverage.format);
  var coverageGlyph = substitution.sub;
  var pos = this.binSearch(subtable.coverage.glyphs, coverageGlyph);
  if (pos < 0) {
    pos = -1 - pos;
    subtable.coverage.glyphs.splice(pos, 0, coverageGlyph);
    subtable.substitute.splice(pos, 0, 0);
  }
  subtable.substitute[pos] = substitution.by;
};
Substitution.prototype.addMultiple = function(feature, substitution, script, language) {
  check.assert(substitution.by instanceof Array && substitution.by.length > 1, 'Multiple: "by" must be an array of two or more ids');
  var lookupTable = this.getLookupTables(script, language, feature, 2, true)[0];
  var subtable = getSubstFormat(lookupTable, 1, {
    // lookup type 2 subtable, format 1, coverage format 1
    substFormat: 1,
    coverage: { format: 1, glyphs: [] },
    sequences: []
  });
  check.assert(subtable.coverage.format === 1, "Multiple: unable to modify coverage table format " + subtable.coverage.format);
  var coverageGlyph = substitution.sub;
  var pos = this.binSearch(subtable.coverage.glyphs, coverageGlyph);
  if (pos < 0) {
    pos = -1 - pos;
    subtable.coverage.glyphs.splice(pos, 0, coverageGlyph);
    subtable.sequences.splice(pos, 0, 0);
  }
  subtable.sequences[pos] = substitution.by;
};
Substitution.prototype.addAlternate = function(feature, substitution, script, language) {
  var lookupTable = this.getLookupTables(script, language, feature, 3, true)[0];
  var subtable = getSubstFormat(lookupTable, 1, {
    // lookup type 3 subtable, format 1, coverage format 1
    substFormat: 1,
    coverage: { format: 1, glyphs: [] },
    alternateSets: []
  });
  check.assert(subtable.coverage.format === 1, "Alternate: unable to modify coverage table format " + subtable.coverage.format);
  var coverageGlyph = substitution.sub;
  var pos = this.binSearch(subtable.coverage.glyphs, coverageGlyph);
  if (pos < 0) {
    pos = -1 - pos;
    subtable.coverage.glyphs.splice(pos, 0, coverageGlyph);
    subtable.alternateSets.splice(pos, 0, 0);
  }
  subtable.alternateSets[pos] = substitution.by;
};
Substitution.prototype.addLigature = function(feature, ligature, script, language) {
  var lookupTable = this.getLookupTables(script, language, feature, 4, true)[0];
  var subtable = lookupTable.subtables[0];
  if (!subtable) {
    subtable = {
      // lookup type 4 subtable, format 1, coverage format 1
      substFormat: 1,
      coverage: { format: 1, glyphs: [] },
      ligatureSets: []
    };
    lookupTable.subtables[0] = subtable;
  }
  check.assert(subtable.coverage.format === 1, "Ligature: unable to modify coverage table format " + subtable.coverage.format);
  var coverageGlyph = ligature.sub[0];
  var ligComponents = ligature.sub.slice(1);
  var ligatureTable = {
    ligGlyph: ligature.by,
    components: ligComponents
  };
  var pos = this.binSearch(subtable.coverage.glyphs, coverageGlyph);
  if (pos >= 0) {
    var ligatureSet = subtable.ligatureSets[pos];
    for (var i = 0; i < ligatureSet.length; i++) {
      if (arraysEqual(ligatureSet[i].components, ligComponents)) {
        return;
      }
    }
    ligatureSet.push(ligatureTable);
  } else {
    pos = -1 - pos;
    subtable.coverage.glyphs.splice(pos, 0, coverageGlyph);
    subtable.ligatureSets.splice(pos, 0, [ligatureTable]);
  }
};
Substitution.prototype.getFeature = function(feature, script, language) {
  if (/ss\d\d/.test(feature)) {
    return this.getSingle(feature, script, language);
  }
  switch (feature) {
    case "aalt":
    case "salt":
      return this.getSingle(feature, script, language).concat(this.getAlternates(feature, script, language));
    case "dlig":
    case "liga":
    case "rlig":
      return this.getLigatures(feature, script, language);
    case "ccmp":
      return this.getMultiple(feature, script, language).concat(this.getLigatures(feature, script, language));
    case "stch":
      return this.getMultiple(feature, script, language);
  }
  return void 0;
};
Substitution.prototype.add = function(feature, sub, script, language) {
  if (/ss\d\d/.test(feature)) {
    return this.addSingle(feature, sub, script, language);
  }
  switch (feature) {
    case "aalt":
    case "salt":
      if (typeof sub.by === "number") {
        return this.addSingle(feature, sub, script, language);
      }
      return this.addAlternate(feature, sub, script, language);
    case "dlig":
    case "liga":
    case "rlig":
      return this.addLigature(feature, sub, script, language);
    case "ccmp":
      if (sub.by instanceof Array) {
        return this.addMultiple(feature, sub, script, language);
      }
      return this.addLigature(feature, sub, script, language);
  }
  return void 0;
};
function isBrowser() {
  return typeof window !== "undefined";
}
function nodeBufferToArrayBuffer(buffer) {
  var ab = new ArrayBuffer(buffer.length);
  var view = new Uint8Array(ab);
  for (var i = 0; i < buffer.length; ++i) {
    view[i] = buffer[i];
  }
  return ab;
}
function arrayBufferToNodeBuffer(ab) {
  var buffer = new Buffer(ab.byteLength);
  var view = new Uint8Array(ab);
  for (var i = 0; i < buffer.length; ++i) {
    buffer[i] = view[i];
  }
  return buffer;
}
function checkArgument(expression, message) {
  if (!expression) {
    throw message;
  }
}
function parseGlyphCoordinate(p, flag, previousValue, shortVectorBitMask, sameBitMask) {
  var v;
  if ((flag & shortVectorBitMask) > 0) {
    v = p.parseByte();
    if ((flag & sameBitMask) === 0) {
      v = -v;
    }
    v = previousValue + v;
  } else {
    if ((flag & sameBitMask) > 0) {
      v = previousValue;
    } else {
      v = previousValue + p.parseShort();
    }
  }
  return v;
}
function parseGlyph(glyph, data, start) {
  var p = new parse.Parser(data, start);
  glyph.numberOfContours = p.parseShort();
  glyph._xMin = p.parseShort();
  glyph._yMin = p.parseShort();
  glyph._xMax = p.parseShort();
  glyph._yMax = p.parseShort();
  var flags;
  var flag;
  if (glyph.numberOfContours > 0) {
    var endPointIndices = glyph.endPointIndices = [];
    for (var i = 0; i < glyph.numberOfContours; i += 1) {
      endPointIndices.push(p.parseUShort());
    }
    glyph.instructionLength = p.parseUShort();
    glyph.instructions = [];
    for (var i$1 = 0; i$1 < glyph.instructionLength; i$1 += 1) {
      glyph.instructions.push(p.parseByte());
    }
    var numberOfCoordinates = endPointIndices[endPointIndices.length - 1] + 1;
    flags = [];
    for (var i$2 = 0; i$2 < numberOfCoordinates; i$2 += 1) {
      flag = p.parseByte();
      flags.push(flag);
      if ((flag & 8) > 0) {
        var repeatCount = p.parseByte();
        for (var j = 0; j < repeatCount; j += 1) {
          flags.push(flag);
          i$2 += 1;
        }
      }
    }
    check.argument(flags.length === numberOfCoordinates, "Bad flags.");
    if (endPointIndices.length > 0) {
      var points = [];
      var point;
      if (numberOfCoordinates > 0) {
        for (var i$3 = 0; i$3 < numberOfCoordinates; i$3 += 1) {
          flag = flags[i$3];
          point = {};
          point.onCurve = !!(flag & 1);
          point.lastPointOfContour = endPointIndices.indexOf(i$3) >= 0;
          points.push(point);
        }
        var px = 0;
        for (var i$4 = 0; i$4 < numberOfCoordinates; i$4 += 1) {
          flag = flags[i$4];
          point = points[i$4];
          point.x = parseGlyphCoordinate(p, flag, px, 2, 16);
          px = point.x;
        }
        var py = 0;
        for (var i$5 = 0; i$5 < numberOfCoordinates; i$5 += 1) {
          flag = flags[i$5];
          point = points[i$5];
          point.y = parseGlyphCoordinate(p, flag, py, 4, 32);
          py = point.y;
        }
      }
      glyph.points = points;
    } else {
      glyph.points = [];
    }
  } else if (glyph.numberOfContours === 0) {
    glyph.points = [];
  } else {
    glyph.isComposite = true;
    glyph.points = [];
    glyph.components = [];
    var moreComponents = true;
    while (moreComponents) {
      flags = p.parseUShort();
      var component = {
        glyphIndex: p.parseUShort(),
        xScale: 1,
        scale01: 0,
        scale10: 0,
        yScale: 1,
        dx: 0,
        dy: 0
      };
      if ((flags & 1) > 0) {
        if ((flags & 2) > 0) {
          component.dx = p.parseShort();
          component.dy = p.parseShort();
        } else {
          component.matchedPoints = [p.parseUShort(), p.parseUShort()];
        }
      } else {
        if ((flags & 2) > 0) {
          component.dx = p.parseChar();
          component.dy = p.parseChar();
        } else {
          component.matchedPoints = [p.parseByte(), p.parseByte()];
        }
      }
      if ((flags & 8) > 0) {
        component.xScale = component.yScale = p.parseF2Dot14();
      } else if ((flags & 64) > 0) {
        component.xScale = p.parseF2Dot14();
        component.yScale = p.parseF2Dot14();
      } else if ((flags & 128) > 0) {
        component.xScale = p.parseF2Dot14();
        component.scale01 = p.parseF2Dot14();
        component.scale10 = p.parseF2Dot14();
        component.yScale = p.parseF2Dot14();
      }
      glyph.components.push(component);
      moreComponents = !!(flags & 32);
    }
    if (flags & 256) {
      glyph.instructionLength = p.parseUShort();
      glyph.instructions = [];
      for (var i$6 = 0; i$6 < glyph.instructionLength; i$6 += 1) {
        glyph.instructions.push(p.parseByte());
      }
    }
  }
}
function transformPoints(points, transform) {
  var newPoints = [];
  for (var i = 0; i < points.length; i += 1) {
    var pt = points[i];
    var newPt = {
      x: transform.xScale * pt.x + transform.scale01 * pt.y + transform.dx,
      y: transform.scale10 * pt.x + transform.yScale * pt.y + transform.dy,
      onCurve: pt.onCurve,
      lastPointOfContour: pt.lastPointOfContour
    };
    newPoints.push(newPt);
  }
  return newPoints;
}
function getContours(points) {
  var contours = [];
  var currentContour = [];
  for (var i = 0; i < points.length; i += 1) {
    var pt = points[i];
    currentContour.push(pt);
    if (pt.lastPointOfContour) {
      contours.push(currentContour);
      currentContour = [];
    }
  }
  check.argument(currentContour.length === 0, "There are still points left in the current contour.");
  return contours;
}
function getPath(points) {
  var p = new Path();
  if (!points) {
    return p;
  }
  var contours = getContours(points);
  for (var contourIndex = 0; contourIndex < contours.length; ++contourIndex) {
    var contour = contours[contourIndex];
    var prev = null;
    var curr = contour[contour.length - 1];
    var next = contour[0];
    if (curr.onCurve) {
      p.moveTo(curr.x, curr.y);
    } else {
      if (next.onCurve) {
        p.moveTo(next.x, next.y);
      } else {
        var start = { x: (curr.x + next.x) * 0.5, y: (curr.y + next.y) * 0.5 };
        p.moveTo(start.x, start.y);
      }
    }
    for (var i = 0; i < contour.length; ++i) {
      prev = curr;
      curr = next;
      next = contour[(i + 1) % contour.length];
      if (curr.onCurve) {
        p.lineTo(curr.x, curr.y);
      } else {
        var prev2 = prev;
        var next2 = next;
        if (!prev.onCurve) {
          prev2 = { x: (curr.x + prev.x) * 0.5, y: (curr.y + prev.y) * 0.5 };
        }
        if (!next.onCurve) {
          next2 = { x: (curr.x + next.x) * 0.5, y: (curr.y + next.y) * 0.5 };
        }
        p.quadraticCurveTo(curr.x, curr.y, next2.x, next2.y);
      }
    }
    p.closePath();
  }
  return p;
}
function buildPath(glyphs, glyph) {
  if (glyph.isComposite) {
    for (var j = 0; j < glyph.components.length; j += 1) {
      var component = glyph.components[j];
      var componentGlyph = glyphs.get(component.glyphIndex);
      componentGlyph.getPath();
      if (componentGlyph.points) {
        var transformedPoints = void 0;
        if (component.matchedPoints === void 0) {
          transformedPoints = transformPoints(componentGlyph.points, component);
        } else {
          if (component.matchedPoints[0] > glyph.points.length - 1 || component.matchedPoints[1] > componentGlyph.points.length - 1) {
            throw Error("Matched points out of range in " + glyph.name);
          }
          var firstPt = glyph.points[component.matchedPoints[0]];
          var secondPt = componentGlyph.points[component.matchedPoints[1]];
          var transform = {
            xScale: component.xScale,
            scale01: component.scale01,
            scale10: component.scale10,
            yScale: component.yScale,
            dx: 0,
            dy: 0
          };
          secondPt = transformPoints([secondPt], transform)[0];
          transform.dx = firstPt.x - secondPt.x;
          transform.dy = firstPt.y - secondPt.y;
          transformedPoints = transformPoints(componentGlyph.points, transform);
        }
        glyph.points = glyph.points.concat(transformedPoints);
      }
    }
  }
  return getPath(glyph.points);
}
function parseGlyfTableAll(data, start, loca2, font) {
  var glyphs = new glyphset.GlyphSet(font);
  for (var i = 0; i < loca2.length - 1; i += 1) {
    var offset = loca2[i];
    var nextOffset = loca2[i + 1];
    if (offset !== nextOffset) {
      glyphs.push(i, glyphset.ttfGlyphLoader(font, i, parseGlyph, data, start + offset, buildPath));
    } else {
      glyphs.push(i, glyphset.glyphLoader(font, i));
    }
  }
  return glyphs;
}
function parseGlyfTableOnLowMemory(data, start, loca2, font) {
  var glyphs = new glyphset.GlyphSet(font);
  font._push = function(i) {
    var offset = loca2[i];
    var nextOffset = loca2[i + 1];
    if (offset !== nextOffset) {
      glyphs.push(i, glyphset.ttfGlyphLoader(font, i, parseGlyph, data, start + offset, buildPath));
    } else {
      glyphs.push(i, glyphset.glyphLoader(font, i));
    }
  };
  return glyphs;
}
function parseGlyfTable(data, start, loca2, font, opt) {
  if (opt.lowMemory) {
    return parseGlyfTableOnLowMemory(data, start, loca2, font);
  } else {
    return parseGlyfTableAll(data, start, loca2, font);
  }
}
var glyf = { getPath, parse: parseGlyfTable };
var instructionTable;
var exec;
var execGlyph;
var execComponent;
function Hinting(font) {
  this.font = font;
  this.getCommands = function(hPoints) {
    return glyf.getPath(hPoints).commands;
  };
  this._fpgmState = this._prepState = void 0;
  this._errorState = 0;
}
function roundOff(v) {
  return v;
}
function roundToGrid(v) {
  return Math.sign(v) * Math.round(Math.abs(v));
}
function roundToDoubleGrid(v) {
  return Math.sign(v) * Math.round(Math.abs(v * 2)) / 2;
}
function roundToHalfGrid(v) {
  return Math.sign(v) * (Math.round(Math.abs(v) + 0.5) - 0.5);
}
function roundUpToGrid(v) {
  return Math.sign(v) * Math.ceil(Math.abs(v));
}
function roundDownToGrid(v) {
  return Math.sign(v) * Math.floor(Math.abs(v));
}
var roundSuper = function(v) {
  var period = this.srPeriod;
  var phase = this.srPhase;
  var threshold = this.srThreshold;
  var sign = 1;
  if (v < 0) {
    v = -v;
    sign = -1;
  }
  v += threshold - phase;
  v = Math.trunc(v / period) * period;
  v += phase;
  if (v < 0) {
    return phase * sign;
  }
  return v * sign;
};
var xUnitVector = {
  x: 1,
  y: 0,
  axis: "x",
  // Gets the projected distance between two points.
  // o1/o2 ... if true, respective original position is used.
  distance: function(p1, p2, o1, o2) {
    return (o1 ? p1.xo : p1.x) - (o2 ? p2.xo : p2.x);
  },
  // Moves point p so the moved position has the same relative
  // position to the moved positions of rp1 and rp2 than the
  // original positions had.
  //
  // See APPENDIX on INTERPOLATE at the bottom of this file.
  interpolate: function(p, rp1, rp2, pv) {
    var do1;
    var do2;
    var doa1;
    var doa2;
    var dm1;
    var dm2;
    var dt;
    if (!pv || pv === this) {
      do1 = p.xo - rp1.xo;
      do2 = p.xo - rp2.xo;
      dm1 = rp1.x - rp1.xo;
      dm2 = rp2.x - rp2.xo;
      doa1 = Math.abs(do1);
      doa2 = Math.abs(do2);
      dt = doa1 + doa2;
      if (dt === 0) {
        p.x = p.xo + (dm1 + dm2) / 2;
        return;
      }
      p.x = p.xo + (dm1 * doa2 + dm2 * doa1) / dt;
      return;
    }
    do1 = pv.distance(p, rp1, true, true);
    do2 = pv.distance(p, rp2, true, true);
    dm1 = pv.distance(rp1, rp1, false, true);
    dm2 = pv.distance(rp2, rp2, false, true);
    doa1 = Math.abs(do1);
    doa2 = Math.abs(do2);
    dt = doa1 + doa2;
    if (dt === 0) {
      xUnitVector.setRelative(p, p, (dm1 + dm2) / 2, pv, true);
      return;
    }
    xUnitVector.setRelative(p, p, (dm1 * doa2 + dm2 * doa1) / dt, pv, true);
  },
  // Slope of line normal to this
  normalSlope: Number.NEGATIVE_INFINITY,
  // Sets the point 'p' relative to point 'rp'
  // by the distance 'd'.
  //
  // See APPENDIX on SETRELATIVE at the bottom of this file.
  //
  // p   ... point to set
  // rp  ... reference point
  // d   ... distance on projection vector
  // pv  ... projection vector (undefined = this)
  // org ... if true, uses the original position of rp as reference.
  setRelative: function(p, rp, d, pv, org) {
    if (!pv || pv === this) {
      p.x = (org ? rp.xo : rp.x) + d;
      return;
    }
    var rpx = org ? rp.xo : rp.x;
    var rpy = org ? rp.yo : rp.y;
    var rpdx = rpx + d * pv.x;
    var rpdy = rpy + d * pv.y;
    p.x = rpdx + (p.y - rpdy) / pv.normalSlope;
  },
  // Slope of vector line.
  slope: 0,
  // Touches the point p.
  touch: function(p) {
    p.xTouched = true;
  },
  // Tests if a point p is touched.
  touched: function(p) {
    return p.xTouched;
  },
  // Untouches the point p.
  untouch: function(p) {
    p.xTouched = false;
  }
};
var yUnitVector = {
  x: 0,
  y: 1,
  axis: "y",
  // Gets the projected distance between two points.
  // o1/o2 ... if true, respective original position is used.
  distance: function(p1, p2, o1, o2) {
    return (o1 ? p1.yo : p1.y) - (o2 ? p2.yo : p2.y);
  },
  // Moves point p so the moved position has the same relative
  // position to the moved positions of rp1 and rp2 than the
  // original positions had.
  //
  // See APPENDIX on INTERPOLATE at the bottom of this file.
  interpolate: function(p, rp1, rp2, pv) {
    var do1;
    var do2;
    var doa1;
    var doa2;
    var dm1;
    var dm2;
    var dt;
    if (!pv || pv === this) {
      do1 = p.yo - rp1.yo;
      do2 = p.yo - rp2.yo;
      dm1 = rp1.y - rp1.yo;
      dm2 = rp2.y - rp2.yo;
      doa1 = Math.abs(do1);
      doa2 = Math.abs(do2);
      dt = doa1 + doa2;
      if (dt === 0) {
        p.y = p.yo + (dm1 + dm2) / 2;
        return;
      }
      p.y = p.yo + (dm1 * doa2 + dm2 * doa1) / dt;
      return;
    }
    do1 = pv.distance(p, rp1, true, true);
    do2 = pv.distance(p, rp2, true, true);
    dm1 = pv.distance(rp1, rp1, false, true);
    dm2 = pv.distance(rp2, rp2, false, true);
    doa1 = Math.abs(do1);
    doa2 = Math.abs(do2);
    dt = doa1 + doa2;
    if (dt === 0) {
      yUnitVector.setRelative(p, p, (dm1 + dm2) / 2, pv, true);
      return;
    }
    yUnitVector.setRelative(p, p, (dm1 * doa2 + dm2 * doa1) / dt, pv, true);
  },
  // Slope of line normal to this.
  normalSlope: 0,
  // Sets the point 'p' relative to point 'rp'
  // by the distance 'd'
  //
  // See APPENDIX on SETRELATIVE at the bottom of this file.
  //
  // p   ... point to set
  // rp  ... reference point
  // d   ... distance on projection vector
  // pv  ... projection vector (undefined = this)
  // org ... if true, uses the original position of rp as reference.
  setRelative: function(p, rp, d, pv, org) {
    if (!pv || pv === this) {
      p.y = (org ? rp.yo : rp.y) + d;
      return;
    }
    var rpx = org ? rp.xo : rp.x;
    var rpy = org ? rp.yo : rp.y;
    var rpdx = rpx + d * pv.x;
    var rpdy = rpy + d * pv.y;
    p.y = rpdy + pv.normalSlope * (p.x - rpdx);
  },
  // Slope of vector line.
  slope: Number.POSITIVE_INFINITY,
  // Touches the point p.
  touch: function(p) {
    p.yTouched = true;
  },
  // Tests if a point p is touched.
  touched: function(p) {
    return p.yTouched;
  },
  // Untouches the point p.
  untouch: function(p) {
    p.yTouched = false;
  }
};
Object.freeze(xUnitVector);
Object.freeze(yUnitVector);
function UnitVector(x, y) {
  this.x = x;
  this.y = y;
  this.axis = void 0;
  this.slope = y / x;
  this.normalSlope = -x / y;
  Object.freeze(this);
}
UnitVector.prototype.distance = function(p1, p2, o1, o2) {
  return this.x * xUnitVector.distance(p1, p2, o1, o2) + this.y * yUnitVector.distance(p1, p2, o1, o2);
};
UnitVector.prototype.interpolate = function(p, rp1, rp2, pv) {
  var dm1;
  var dm2;
  var do1;
  var do2;
  var doa1;
  var doa2;
  var dt;
  do1 = pv.distance(p, rp1, true, true);
  do2 = pv.distance(p, rp2, true, true);
  dm1 = pv.distance(rp1, rp1, false, true);
  dm2 = pv.distance(rp2, rp2, false, true);
  doa1 = Math.abs(do1);
  doa2 = Math.abs(do2);
  dt = doa1 + doa2;
  if (dt === 0) {
    this.setRelative(p, p, (dm1 + dm2) / 2, pv, true);
    return;
  }
  this.setRelative(p, p, (dm1 * doa2 + dm2 * doa1) / dt, pv, true);
};
UnitVector.prototype.setRelative = function(p, rp, d, pv, org) {
  pv = pv || this;
  var rpx = org ? rp.xo : rp.x;
  var rpy = org ? rp.yo : rp.y;
  var rpdx = rpx + d * pv.x;
  var rpdy = rpy + d * pv.y;
  var pvns = pv.normalSlope;
  var fvs = this.slope;
  var px = p.x;
  var py = p.y;
  p.x = (fvs * px - pvns * rpdx + rpdy - py) / (fvs - pvns);
  p.y = fvs * (p.x - px) + py;
};
UnitVector.prototype.touch = function(p) {
  p.xTouched = true;
  p.yTouched = true;
};
function getUnitVector(x, y) {
  var d = Math.sqrt(x * x + y * y);
  x /= d;
  y /= d;
  if (x === 1 && y === 0) {
    return xUnitVector;
  } else if (x === 0 && y === 1) {
    return yUnitVector;
  } else {
    return new UnitVector(x, y);
  }
}
function HPoint(x, y, lastPointOfContour, onCurve) {
  this.x = this.xo = Math.round(x * 64) / 64;
  this.y = this.yo = Math.round(y * 64) / 64;
  this.lastPointOfContour = lastPointOfContour;
  this.onCurve = onCurve;
  this.prevPointOnContour = void 0;
  this.nextPointOnContour = void 0;
  this.xTouched = false;
  this.yTouched = false;
  Object.preventExtensions(this);
}
HPoint.prototype.nextTouched = function(v) {
  var p = this.nextPointOnContour;
  while (!v.touched(p) && p !== this) {
    p = p.nextPointOnContour;
  }
  return p;
};
HPoint.prototype.prevTouched = function(v) {
  var p = this.prevPointOnContour;
  while (!v.touched(p) && p !== this) {
    p = p.prevPointOnContour;
  }
  return p;
};
var HPZero = Object.freeze(new HPoint(0, 0));
var defaultState = {
  cvCutIn: 17 / 16,
  // control value cut in
  deltaBase: 9,
  deltaShift: 0.125,
  loop: 1,
  // loops some instructions
  minDis: 1,
  // minimum distance
  autoFlip: true
};
function State(env, prog) {
  this.env = env;
  this.stack = [];
  this.prog = prog;
  switch (env) {
    case "glyf":
      this.zp0 = this.zp1 = this.zp2 = 1;
      this.rp0 = this.rp1 = this.rp2 = 0;
    /* fall through */
    case "prep":
      this.fv = this.pv = this.dpv = xUnitVector;
      this.round = roundToGrid;
  }
}
Hinting.prototype.exec = function(glyph, ppem) {
  if (typeof ppem !== "number") {
    throw new Error("Point size is not a number!");
  }
  if (this._errorState > 2) {
    return;
  }
  var font = this.font;
  var prepState = this._prepState;
  if (!prepState || prepState.ppem !== ppem) {
    var fpgmState = this._fpgmState;
    if (!fpgmState) {
      State.prototype = defaultState;
      fpgmState = this._fpgmState = new State("fpgm", font.tables.fpgm);
      fpgmState.funcs = [];
      fpgmState.font = font;
      if (exports.DEBUG) {
        console.log("---EXEC FPGM---");
        fpgmState.step = -1;
      }
      try {
        exec(fpgmState);
      } catch (e) {
        console.log("Hinting error in FPGM:" + e);
        this._errorState = 3;
        return;
      }
    }
    State.prototype = fpgmState;
    prepState = this._prepState = new State("prep", font.tables.prep);
    prepState.ppem = ppem;
    var oCvt = font.tables.cvt;
    if (oCvt) {
      var cvt = prepState.cvt = new Array(oCvt.length);
      var scale = ppem / font.unitsPerEm;
      for (var c = 0; c < oCvt.length; c++) {
        cvt[c] = oCvt[c] * scale;
      }
    } else {
      prepState.cvt = [];
    }
    if (exports.DEBUG) {
      console.log("---EXEC PREP---");
      prepState.step = -1;
    }
    try {
      exec(prepState);
    } catch (e) {
      if (this._errorState < 2) {
        console.log("Hinting error in PREP:" + e);
      }
      this._errorState = 2;
    }
  }
  if (this._errorState > 1) {
    return;
  }
  try {
    return execGlyph(glyph, prepState);
  } catch (e) {
    if (this._errorState < 1) {
      console.log("Hinting error:" + e);
      console.log("Note: further hinting errors are silenced");
    }
    this._errorState = 1;
    return void 0;
  }
};
execGlyph = function(glyph, prepState) {
  var xScale = prepState.ppem / prepState.font.unitsPerEm;
  var yScale = xScale;
  var components = glyph.components;
  var contours;
  var gZone;
  var state;
  State.prototype = prepState;
  if (!components) {
    state = new State("glyf", glyph.instructions);
    if (exports.DEBUG) {
      console.log("---EXEC GLYPH---");
      state.step = -1;
    }
    execComponent(glyph, state, xScale, yScale);
    gZone = state.gZone;
  } else {
    var font = prepState.font;
    gZone = [];
    contours = [];
    for (var i = 0; i < components.length; i++) {
      var c = components[i];
      var cg = font.glyphs.get(c.glyphIndex);
      state = new State("glyf", cg.instructions);
      if (exports.DEBUG) {
        console.log("---EXEC COMP " + i + "---");
        state.step = -1;
      }
      execComponent(cg, state, xScale, yScale);
      var dx = Math.round(c.dx * xScale);
      var dy = Math.round(c.dy * yScale);
      var gz = state.gZone;
      var cc = state.contours;
      for (var pi = 0; pi < gz.length; pi++) {
        var p = gz[pi];
        p.xTouched = p.yTouched = false;
        p.xo = p.x = p.x + dx;
        p.yo = p.y = p.y + dy;
      }
      var gLen = gZone.length;
      gZone.push.apply(gZone, gz);
      for (var j = 0; j < cc.length; j++) {
        contours.push(cc[j] + gLen);
      }
    }
    if (glyph.instructions && !state.inhibitGridFit) {
      state = new State("glyf", glyph.instructions);
      state.gZone = state.z0 = state.z1 = state.z2 = gZone;
      state.contours = contours;
      gZone.push(
        new HPoint(0, 0),
        new HPoint(Math.round(glyph.advanceWidth * xScale), 0)
      );
      if (exports.DEBUG) {
        console.log("---EXEC COMPOSITE---");
        state.step = -1;
      }
      exec(state);
      gZone.length -= 2;
    }
  }
  return gZone;
};
execComponent = function(glyph, state, xScale, yScale) {
  var points = glyph.points || [];
  var pLen = points.length;
  var gZone = state.gZone = state.z0 = state.z1 = state.z2 = [];
  var contours = state.contours = [];
  var cp;
  for (var i = 0; i < pLen; i++) {
    cp = points[i];
    gZone[i] = new HPoint(
      cp.x * xScale,
      cp.y * yScale,
      cp.lastPointOfContour,
      cp.onCurve
    );
  }
  var sp;
  var np;
  for (var i$1 = 0; i$1 < pLen; i$1++) {
    cp = gZone[i$1];
    if (!sp) {
      sp = cp;
      contours.push(i$1);
    }
    if (cp.lastPointOfContour) {
      cp.nextPointOnContour = sp;
      sp.prevPointOnContour = cp;
      sp = void 0;
    } else {
      np = gZone[i$1 + 1];
      cp.nextPointOnContour = np;
      np.prevPointOnContour = cp;
    }
  }
  if (state.inhibitGridFit) {
    return;
  }
  if (exports.DEBUG) {
    console.log("PROCESSING GLYPH", state.stack);
    for (var i$2 = 0; i$2 < pLen; i$2++) {
      console.log(i$2, gZone[i$2].x, gZone[i$2].y);
    }
  }
  gZone.push(
    new HPoint(0, 0),
    new HPoint(Math.round(glyph.advanceWidth * xScale), 0)
  );
  exec(state);
  gZone.length -= 2;
  if (exports.DEBUG) {
    console.log("FINISHED GLYPH", state.stack);
    for (var i$3 = 0; i$3 < pLen; i$3++) {
      console.log(i$3, gZone[i$3].x, gZone[i$3].y);
    }
  }
};
exec = function(state) {
  var prog = state.prog;
  if (!prog) {
    return;
  }
  var pLen = prog.length;
  var ins;
  for (state.ip = 0; state.ip < pLen; state.ip++) {
    if (exports.DEBUG) {
      state.step++;
    }
    ins = instructionTable[prog[state.ip]];
    if (!ins) {
      throw new Error(
        "unknown instruction: 0x" + Number(prog[state.ip]).toString(16)
      );
    }
    ins(state);
  }
};
function initTZone(state) {
  var tZone = state.tZone = new Array(state.gZone.length);
  for (var i = 0; i < tZone.length; i++) {
    tZone[i] = new HPoint(0, 0);
  }
}
function skip(state, handleElse) {
  var prog = state.prog;
  var ip = state.ip;
  var nesting = 1;
  var ins;
  do {
    ins = prog[++ip];
    if (ins === 88) {
      nesting++;
    } else if (ins === 89) {
      nesting--;
    } else if (ins === 64) {
      ip += prog[ip + 1] + 1;
    } else if (ins === 65) {
      ip += 2 * prog[ip + 1] + 1;
    } else if (ins >= 176 && ins <= 183) {
      ip += ins - 176 + 1;
    } else if (ins >= 184 && ins <= 191) {
      ip += (ins - 184 + 1) * 2;
    } else if (handleElse && nesting === 1 && ins === 27) {
      break;
    }
  } while (nesting > 0);
  state.ip = ip;
}
function SVTCA(v, state) {
  if (exports.DEBUG) {
    console.log(state.step, "SVTCA[" + v.axis + "]");
  }
  state.fv = state.pv = state.dpv = v;
}
function SPVTCA(v, state) {
  if (exports.DEBUG) {
    console.log(state.step, "SPVTCA[" + v.axis + "]");
  }
  state.pv = state.dpv = v;
}
function SFVTCA(v, state) {
  if (exports.DEBUG) {
    console.log(state.step, "SFVTCA[" + v.axis + "]");
  }
  state.fv = v;
}
function SPVTL(a, state) {
  var stack = state.stack;
  var p2i = stack.pop();
  var p1i = stack.pop();
  var p2 = state.z2[p2i];
  var p1 = state.z1[p1i];
  if (exports.DEBUG) {
    console.log("SPVTL[" + a + "]", p2i, p1i);
  }
  var dx;
  var dy;
  if (!a) {
    dx = p1.x - p2.x;
    dy = p1.y - p2.y;
  } else {
    dx = p2.y - p1.y;
    dy = p1.x - p2.x;
  }
  state.pv = state.dpv = getUnitVector(dx, dy);
}
function SFVTL(a, state) {
  var stack = state.stack;
  var p2i = stack.pop();
  var p1i = stack.pop();
  var p2 = state.z2[p2i];
  var p1 = state.z1[p1i];
  if (exports.DEBUG) {
    console.log("SFVTL[" + a + "]", p2i, p1i);
  }
  var dx;
  var dy;
  if (!a) {
    dx = p1.x - p2.x;
    dy = p1.y - p2.y;
  } else {
    dx = p2.y - p1.y;
    dy = p1.x - p2.x;
  }
  state.fv = getUnitVector(dx, dy);
}
function SPVFS(state) {
  var stack = state.stack;
  var y = stack.pop();
  var x = stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "SPVFS[]", y, x);
  }
  state.pv = state.dpv = getUnitVector(x, y);
}
function SFVFS(state) {
  var stack = state.stack;
  var y = stack.pop();
  var x = stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "SPVFS[]", y, x);
  }
  state.fv = getUnitVector(x, y);
}
function GPV(state) {
  var stack = state.stack;
  var pv = state.pv;
  if (exports.DEBUG) {
    console.log(state.step, "GPV[]");
  }
  stack.push(pv.x * 16384);
  stack.push(pv.y * 16384);
}
function GFV(state) {
  var stack = state.stack;
  var fv = state.fv;
  if (exports.DEBUG) {
    console.log(state.step, "GFV[]");
  }
  stack.push(fv.x * 16384);
  stack.push(fv.y * 16384);
}
function SFVTPV(state) {
  state.fv = state.pv;
  if (exports.DEBUG) {
    console.log(state.step, "SFVTPV[]");
  }
}
function ISECT(state) {
  var stack = state.stack;
  var pa0i = stack.pop();
  var pa1i = stack.pop();
  var pb0i = stack.pop();
  var pb1i = stack.pop();
  var pi = stack.pop();
  var z0 = state.z0;
  var z1 = state.z1;
  var pa0 = z0[pa0i];
  var pa1 = z0[pa1i];
  var pb0 = z1[pb0i];
  var pb1 = z1[pb1i];
  var p = state.z2[pi];
  if (exports.DEBUG) {
    console.log("ISECT[], ", pa0i, pa1i, pb0i, pb1i, pi);
  }
  var x1 = pa0.x;
  var y1 = pa0.y;
  var x2 = pa1.x;
  var y2 = pa1.y;
  var x3 = pb0.x;
  var y3 = pb0.y;
  var x4 = pb1.x;
  var y4 = pb1.y;
  var div = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  var f1 = x1 * y2 - y1 * x2;
  var f2 = x3 * y4 - y3 * x4;
  p.x = (f1 * (x3 - x4) - f2 * (x1 - x2)) / div;
  p.y = (f1 * (y3 - y4) - f2 * (y1 - y2)) / div;
}
function SRP0(state) {
  state.rp0 = state.stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "SRP0[]", state.rp0);
  }
}
function SRP1(state) {
  state.rp1 = state.stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "SRP1[]", state.rp1);
  }
}
function SRP2(state) {
  state.rp2 = state.stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "SRP2[]", state.rp2);
  }
}
function SZP0(state) {
  var n = state.stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "SZP0[]", n);
  }
  state.zp0 = n;
  switch (n) {
    case 0:
      if (!state.tZone) {
        initTZone(state);
      }
      state.z0 = state.tZone;
      break;
    case 1:
      state.z0 = state.gZone;
      break;
    default:
      throw new Error("Invalid zone pointer");
  }
}
function SZP1(state) {
  var n = state.stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "SZP1[]", n);
  }
  state.zp1 = n;
  switch (n) {
    case 0:
      if (!state.tZone) {
        initTZone(state);
      }
      state.z1 = state.tZone;
      break;
    case 1:
      state.z1 = state.gZone;
      break;
    default:
      throw new Error("Invalid zone pointer");
  }
}
function SZP2(state) {
  var n = state.stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "SZP2[]", n);
  }
  state.zp2 = n;
  switch (n) {
    case 0:
      if (!state.tZone) {
        initTZone(state);
      }
      state.z2 = state.tZone;
      break;
    case 1:
      state.z2 = state.gZone;
      break;
    default:
      throw new Error("Invalid zone pointer");
  }
}
function SZPS(state) {
  var n = state.stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "SZPS[]", n);
  }
  state.zp0 = state.zp1 = state.zp2 = n;
  switch (n) {
    case 0:
      if (!state.tZone) {
        initTZone(state);
      }
      state.z0 = state.z1 = state.z2 = state.tZone;
      break;
    case 1:
      state.z0 = state.z1 = state.z2 = state.gZone;
      break;
    default:
      throw new Error("Invalid zone pointer");
  }
}
function SLOOP(state) {
  state.loop = state.stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "SLOOP[]", state.loop);
  }
}
function RTG(state) {
  if (exports.DEBUG) {
    console.log(state.step, "RTG[]");
  }
  state.round = roundToGrid;
}
function RTHG(state) {
  if (exports.DEBUG) {
    console.log(state.step, "RTHG[]");
  }
  state.round = roundToHalfGrid;
}
function SMD(state) {
  var d = state.stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "SMD[]", d);
  }
  state.minDis = d / 64;
}
function ELSE(state) {
  if (exports.DEBUG) {
    console.log(state.step, "ELSE[]");
  }
  skip(state, false);
}
function JMPR(state) {
  var o = state.stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "JMPR[]", o);
  }
  state.ip += o - 1;
}
function SCVTCI(state) {
  var n = state.stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "SCVTCI[]", n);
  }
  state.cvCutIn = n / 64;
}
function DUP(state) {
  var stack = state.stack;
  if (exports.DEBUG) {
    console.log(state.step, "DUP[]");
  }
  stack.push(stack[stack.length - 1]);
}
function POP(state) {
  if (exports.DEBUG) {
    console.log(state.step, "POP[]");
  }
  state.stack.pop();
}
function CLEAR(state) {
  if (exports.DEBUG) {
    console.log(state.step, "CLEAR[]");
  }
  state.stack.length = 0;
}
function SWAP(state) {
  var stack = state.stack;
  var a = stack.pop();
  var b = stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "SWAP[]");
  }
  stack.push(a);
  stack.push(b);
}
function DEPTH(state) {
  var stack = state.stack;
  if (exports.DEBUG) {
    console.log(state.step, "DEPTH[]");
  }
  stack.push(stack.length);
}
function LOOPCALL(state) {
  var stack = state.stack;
  var fn = stack.pop();
  var c = stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "LOOPCALL[]", fn, c);
  }
  var cip = state.ip;
  var cprog = state.prog;
  state.prog = state.funcs[fn];
  for (var i = 0; i < c; i++) {
    exec(state);
    if (exports.DEBUG) {
      console.log(
        ++state.step,
        i + 1 < c ? "next loopcall" : "done loopcall",
        i
      );
    }
  }
  state.ip = cip;
  state.prog = cprog;
}
function CALL(state) {
  var fn = state.stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "CALL[]", fn);
  }
  var cip = state.ip;
  var cprog = state.prog;
  state.prog = state.funcs[fn];
  exec(state);
  state.ip = cip;
  state.prog = cprog;
  if (exports.DEBUG) {
    console.log(++state.step, "returning from", fn);
  }
}
function CINDEX(state) {
  var stack = state.stack;
  var k = stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "CINDEX[]", k);
  }
  stack.push(stack[stack.length - k]);
}
function MINDEX(state) {
  var stack = state.stack;
  var k = stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "MINDEX[]", k);
  }
  stack.push(stack.splice(stack.length - k, 1)[0]);
}
function FDEF(state) {
  if (state.env !== "fpgm") {
    throw new Error("FDEF not allowed here");
  }
  var stack = state.stack;
  var prog = state.prog;
  var ip = state.ip;
  var fn = stack.pop();
  var ipBegin = ip;
  if (exports.DEBUG) {
    console.log(state.step, "FDEF[]", fn);
  }
  while (prog[++ip] !== 45) {
  }
  state.ip = ip;
  state.funcs[fn] = prog.slice(ipBegin + 1, ip);
}
function MDAP(round, state) {
  var pi = state.stack.pop();
  var p = state.z0[pi];
  var fv = state.fv;
  var pv = state.pv;
  if (exports.DEBUG) {
    console.log(state.step, "MDAP[" + round + "]", pi);
  }
  var d = pv.distance(p, HPZero);
  if (round) {
    d = state.round(d);
  }
  fv.setRelative(p, HPZero, d, pv);
  fv.touch(p);
  state.rp0 = state.rp1 = pi;
}
function IUP(v, state) {
  var z2 = state.z2;
  var pLen = z2.length - 2;
  var cp;
  var pp;
  var np;
  if (exports.DEBUG) {
    console.log(state.step, "IUP[" + v.axis + "]");
  }
  for (var i = 0; i < pLen; i++) {
    cp = z2[i];
    if (v.touched(cp)) {
      continue;
    }
    pp = cp.prevTouched(v);
    if (pp === cp) {
      continue;
    }
    np = cp.nextTouched(v);
    if (pp === np) {
      v.setRelative(cp, cp, v.distance(pp, pp, false, true), v, true);
    }
    v.interpolate(cp, pp, np, v);
  }
}
function SHP(a, state) {
  var stack = state.stack;
  var rpi = a ? state.rp1 : state.rp2;
  var rp = (a ? state.z0 : state.z1)[rpi];
  var fv = state.fv;
  var pv = state.pv;
  var loop = state.loop;
  var z2 = state.z2;
  while (loop--) {
    var pi = stack.pop();
    var p = z2[pi];
    var d = pv.distance(rp, rp, false, true);
    fv.setRelative(p, p, d, pv);
    fv.touch(p);
    if (exports.DEBUG) {
      console.log(
        state.step,
        (state.loop > 1 ? "loop " + (state.loop - loop) + ": " : "") + "SHP[" + (a ? "rp1" : "rp2") + "]",
        pi
      );
    }
  }
  state.loop = 1;
}
function SHC(a, state) {
  var stack = state.stack;
  var rpi = a ? state.rp1 : state.rp2;
  var rp = (a ? state.z0 : state.z1)[rpi];
  var fv = state.fv;
  var pv = state.pv;
  var ci = stack.pop();
  var sp = state.z2[state.contours[ci]];
  var p = sp;
  if (exports.DEBUG) {
    console.log(state.step, "SHC[" + a + "]", ci);
  }
  var d = pv.distance(rp, rp, false, true);
  do {
    if (p !== rp) {
      fv.setRelative(p, p, d, pv);
    }
    p = p.nextPointOnContour;
  } while (p !== sp);
}
function SHZ(a, state) {
  var stack = state.stack;
  var rpi = a ? state.rp1 : state.rp2;
  var rp = (a ? state.z0 : state.z1)[rpi];
  var fv = state.fv;
  var pv = state.pv;
  var e = stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "SHZ[" + a + "]", e);
  }
  var z;
  switch (e) {
    case 0:
      z = state.tZone;
      break;
    case 1:
      z = state.gZone;
      break;
    default:
      throw new Error("Invalid zone");
  }
  var p;
  var d = pv.distance(rp, rp, false, true);
  var pLen = z.length - 2;
  for (var i = 0; i < pLen; i++) {
    p = z[i];
    fv.setRelative(p, p, d, pv);
  }
}
function SHPIX(state) {
  var stack = state.stack;
  var loop = state.loop;
  var fv = state.fv;
  var d = stack.pop() / 64;
  var z2 = state.z2;
  while (loop--) {
    var pi = stack.pop();
    var p = z2[pi];
    if (exports.DEBUG) {
      console.log(
        state.step,
        (state.loop > 1 ? "loop " + (state.loop - loop) + ": " : "") + "SHPIX[]",
        pi,
        d
      );
    }
    fv.setRelative(p, p, d);
    fv.touch(p);
  }
  state.loop = 1;
}
function IP(state) {
  var stack = state.stack;
  var rp1i = state.rp1;
  var rp2i = state.rp2;
  var loop = state.loop;
  var rp1 = state.z0[rp1i];
  var rp2 = state.z1[rp2i];
  var fv = state.fv;
  var pv = state.dpv;
  var z2 = state.z2;
  while (loop--) {
    var pi = stack.pop();
    var p = z2[pi];
    if (exports.DEBUG) {
      console.log(
        state.step,
        (state.loop > 1 ? "loop " + (state.loop - loop) + ": " : "") + "IP[]",
        pi,
        rp1i,
        "<->",
        rp2i
      );
    }
    fv.interpolate(p, rp1, rp2, pv);
    fv.touch(p);
  }
  state.loop = 1;
}
function MSIRP(a, state) {
  var stack = state.stack;
  var d = stack.pop() / 64;
  var pi = stack.pop();
  var p = state.z1[pi];
  var rp0 = state.z0[state.rp0];
  var fv = state.fv;
  var pv = state.pv;
  fv.setRelative(p, rp0, d, pv);
  fv.touch(p);
  if (exports.DEBUG) {
    console.log(state.step, "MSIRP[" + a + "]", d, pi);
  }
  state.rp1 = state.rp0;
  state.rp2 = pi;
  if (a) {
    state.rp0 = pi;
  }
}
function ALIGNRP(state) {
  var stack = state.stack;
  var rp0i = state.rp0;
  var rp0 = state.z0[rp0i];
  var loop = state.loop;
  var fv = state.fv;
  var pv = state.pv;
  var z1 = state.z1;
  while (loop--) {
    var pi = stack.pop();
    var p = z1[pi];
    if (exports.DEBUG) {
      console.log(
        state.step,
        (state.loop > 1 ? "loop " + (state.loop - loop) + ": " : "") + "ALIGNRP[]",
        pi
      );
    }
    fv.setRelative(p, rp0, 0, pv);
    fv.touch(p);
  }
  state.loop = 1;
}
function RTDG(state) {
  if (exports.DEBUG) {
    console.log(state.step, "RTDG[]");
  }
  state.round = roundToDoubleGrid;
}
function MIAP(round, state) {
  var stack = state.stack;
  var n = stack.pop();
  var pi = stack.pop();
  var p = state.z0[pi];
  var fv = state.fv;
  var pv = state.pv;
  var cv = state.cvt[n];
  if (exports.DEBUG) {
    console.log(
      state.step,
      "MIAP[" + round + "]",
      n,
      "(",
      cv,
      ")",
      pi
    );
  }
  var d = pv.distance(p, HPZero);
  if (round) {
    if (Math.abs(d - cv) < state.cvCutIn) {
      d = cv;
    }
    d = state.round(d);
  }
  fv.setRelative(p, HPZero, d, pv);
  if (state.zp0 === 0) {
    p.xo = p.x;
    p.yo = p.y;
  }
  fv.touch(p);
  state.rp0 = state.rp1 = pi;
}
function NPUSHB(state) {
  var prog = state.prog;
  var ip = state.ip;
  var stack = state.stack;
  var n = prog[++ip];
  if (exports.DEBUG) {
    console.log(state.step, "NPUSHB[]", n);
  }
  for (var i = 0; i < n; i++) {
    stack.push(prog[++ip]);
  }
  state.ip = ip;
}
function NPUSHW(state) {
  var ip = state.ip;
  var prog = state.prog;
  var stack = state.stack;
  var n = prog[++ip];
  if (exports.DEBUG) {
    console.log(state.step, "NPUSHW[]", n);
  }
  for (var i = 0; i < n; i++) {
    var w = prog[++ip] << 8 | prog[++ip];
    if (w & 32768) {
      w = -((w ^ 65535) + 1);
    }
    stack.push(w);
  }
  state.ip = ip;
}
function WS(state) {
  var stack = state.stack;
  var store = state.store;
  if (!store) {
    store = state.store = [];
  }
  var v = stack.pop();
  var l = stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "WS", v, l);
  }
  store[l] = v;
}
function RS(state) {
  var stack = state.stack;
  var store = state.store;
  var l = stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "RS", l);
  }
  var v = store && store[l] || 0;
  stack.push(v);
}
function WCVTP(state) {
  var stack = state.stack;
  var v = stack.pop();
  var l = stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "WCVTP", v, l);
  }
  state.cvt[l] = v / 64;
}
function RCVT(state) {
  var stack = state.stack;
  var cvte = stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "RCVT", cvte);
  }
  stack.push(state.cvt[cvte] * 64);
}
function GC(a, state) {
  var stack = state.stack;
  var pi = stack.pop();
  var p = state.z2[pi];
  if (exports.DEBUG) {
    console.log(state.step, "GC[" + a + "]", pi);
  }
  stack.push(state.dpv.distance(p, HPZero, a, false) * 64);
}
function MD(a, state) {
  var stack = state.stack;
  var pi2 = stack.pop();
  var pi1 = stack.pop();
  var p2 = state.z1[pi2];
  var p1 = state.z0[pi1];
  var d = state.dpv.distance(p1, p2, a, a);
  if (exports.DEBUG) {
    console.log(state.step, "MD[" + a + "]", pi2, pi1, "->", d);
  }
  state.stack.push(Math.round(d * 64));
}
function MPPEM(state) {
  if (exports.DEBUG) {
    console.log(state.step, "MPPEM[]");
  }
  state.stack.push(state.ppem);
}
function FLIPON(state) {
  if (exports.DEBUG) {
    console.log(state.step, "FLIPON[]");
  }
  state.autoFlip = true;
}
function LT(state) {
  var stack = state.stack;
  var e2 = stack.pop();
  var e1 = stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "LT[]", e2, e1);
  }
  stack.push(e1 < e2 ? 1 : 0);
}
function LTEQ(state) {
  var stack = state.stack;
  var e2 = stack.pop();
  var e1 = stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "LTEQ[]", e2, e1);
  }
  stack.push(e1 <= e2 ? 1 : 0);
}
function GT(state) {
  var stack = state.stack;
  var e2 = stack.pop();
  var e1 = stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "GT[]", e2, e1);
  }
  stack.push(e1 > e2 ? 1 : 0);
}
function GTEQ(state) {
  var stack = state.stack;
  var e2 = stack.pop();
  var e1 = stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "GTEQ[]", e2, e1);
  }
  stack.push(e1 >= e2 ? 1 : 0);
}
function EQ(state) {
  var stack = state.stack;
  var e2 = stack.pop();
  var e1 = stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "EQ[]", e2, e1);
  }
  stack.push(e2 === e1 ? 1 : 0);
}
function NEQ(state) {
  var stack = state.stack;
  var e2 = stack.pop();
  var e1 = stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "NEQ[]", e2, e1);
  }
  stack.push(e2 !== e1 ? 1 : 0);
}
function ODD(state) {
  var stack = state.stack;
  var n = stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "ODD[]", n);
  }
  stack.push(Math.trunc(n) % 2 ? 1 : 0);
}
function EVEN(state) {
  var stack = state.stack;
  var n = stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "EVEN[]", n);
  }
  stack.push(Math.trunc(n) % 2 ? 0 : 1);
}
function IF(state) {
  var test = state.stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "IF[]", test);
  }
  if (!test) {
    skip(state, true);
    if (exports.DEBUG) {
      console.log(state.step, "EIF[]");
    }
  }
}
function EIF(state) {
  if (exports.DEBUG) {
    console.log(state.step, "EIF[]");
  }
}
function AND(state) {
  var stack = state.stack;
  var e2 = stack.pop();
  var e1 = stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "AND[]", e2, e1);
  }
  stack.push(e2 && e1 ? 1 : 0);
}
function OR(state) {
  var stack = state.stack;
  var e2 = stack.pop();
  var e1 = stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "OR[]", e2, e1);
  }
  stack.push(e2 || e1 ? 1 : 0);
}
function NOT(state) {
  var stack = state.stack;
  var e = stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "NOT[]", e);
  }
  stack.push(e ? 0 : 1);
}
function DELTAP123(b, state) {
  var stack = state.stack;
  var n = stack.pop();
  var fv = state.fv;
  var pv = state.pv;
  var ppem = state.ppem;
  var base = state.deltaBase + (b - 1) * 16;
  var ds = state.deltaShift;
  var z0 = state.z0;
  if (exports.DEBUG) {
    console.log(state.step, "DELTAP[" + b + "]", n, stack);
  }
  for (var i = 0; i < n; i++) {
    var pi = stack.pop();
    var arg = stack.pop();
    var appem = base + ((arg & 240) >> 4);
    if (appem !== ppem) {
      continue;
    }
    var mag = (arg & 15) - 8;
    if (mag >= 0) {
      mag++;
    }
    if (exports.DEBUG) {
      console.log(state.step, "DELTAPFIX", pi, "by", mag * ds);
    }
    var p = z0[pi];
    fv.setRelative(p, p, mag * ds, pv);
  }
}
function SDB(state) {
  var stack = state.stack;
  var n = stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "SDB[]", n);
  }
  state.deltaBase = n;
}
function SDS(state) {
  var stack = state.stack;
  var n = stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "SDS[]", n);
  }
  state.deltaShift = Math.pow(0.5, n);
}
function ADD(state) {
  var stack = state.stack;
  var n2 = stack.pop();
  var n1 = stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "ADD[]", n2, n1);
  }
  stack.push(n1 + n2);
}
function SUB(state) {
  var stack = state.stack;
  var n2 = stack.pop();
  var n1 = stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "SUB[]", n2, n1);
  }
  stack.push(n1 - n2);
}
function DIV(state) {
  var stack = state.stack;
  var n2 = stack.pop();
  var n1 = stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "DIV[]", n2, n1);
  }
  stack.push(n1 * 64 / n2);
}
function MUL(state) {
  var stack = state.stack;
  var n2 = stack.pop();
  var n1 = stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "MUL[]", n2, n1);
  }
  stack.push(n1 * n2 / 64);
}
function ABS(state) {
  var stack = state.stack;
  var n = stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "ABS[]", n);
  }
  stack.push(Math.abs(n));
}
function NEG(state) {
  var stack = state.stack;
  var n = stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "NEG[]", n);
  }
  stack.push(-n);
}
function FLOOR(state) {
  var stack = state.stack;
  var n = stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "FLOOR[]", n);
  }
  stack.push(Math.floor(n / 64) * 64);
}
function CEILING(state) {
  var stack = state.stack;
  var n = stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "CEILING[]", n);
  }
  stack.push(Math.ceil(n / 64) * 64);
}
function ROUND(dt, state) {
  var stack = state.stack;
  var n = stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "ROUND[]");
  }
  stack.push(state.round(n / 64) * 64);
}
function WCVTF(state) {
  var stack = state.stack;
  var v = stack.pop();
  var l = stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "WCVTF[]", v, l);
  }
  state.cvt[l] = v * state.ppem / state.font.unitsPerEm;
}
function DELTAC123(b, state) {
  var stack = state.stack;
  var n = stack.pop();
  var ppem = state.ppem;
  var base = state.deltaBase + (b - 1) * 16;
  var ds = state.deltaShift;
  if (exports.DEBUG) {
    console.log(state.step, "DELTAC[" + b + "]", n, stack);
  }
  for (var i = 0; i < n; i++) {
    var c = stack.pop();
    var arg = stack.pop();
    var appem = base + ((arg & 240) >> 4);
    if (appem !== ppem) {
      continue;
    }
    var mag = (arg & 15) - 8;
    if (mag >= 0) {
      mag++;
    }
    var delta = mag * ds;
    if (exports.DEBUG) {
      console.log(state.step, "DELTACFIX", c, "by", delta);
    }
    state.cvt[c] += delta;
  }
}
function SROUND(state) {
  var n = state.stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "SROUND[]", n);
  }
  state.round = roundSuper;
  var period;
  switch (n & 192) {
    case 0:
      period = 0.5;
      break;
    case 64:
      period = 1;
      break;
    case 128:
      period = 2;
      break;
    default:
      throw new Error("invalid SROUND value");
  }
  state.srPeriod = period;
  switch (n & 48) {
    case 0:
      state.srPhase = 0;
      break;
    case 16:
      state.srPhase = 0.25 * period;
      break;
    case 32:
      state.srPhase = 0.5 * period;
      break;
    case 48:
      state.srPhase = 0.75 * period;
      break;
    default:
      throw new Error("invalid SROUND value");
  }
  n &= 15;
  if (n === 0) {
    state.srThreshold = 0;
  } else {
    state.srThreshold = (n / 8 - 0.5) * period;
  }
}
function S45ROUND(state) {
  var n = state.stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "S45ROUND[]", n);
  }
  state.round = roundSuper;
  var period;
  switch (n & 192) {
    case 0:
      period = Math.sqrt(2) / 2;
      break;
    case 64:
      period = Math.sqrt(2);
      break;
    case 128:
      period = 2 * Math.sqrt(2);
      break;
    default:
      throw new Error("invalid S45ROUND value");
  }
  state.srPeriod = period;
  switch (n & 48) {
    case 0:
      state.srPhase = 0;
      break;
    case 16:
      state.srPhase = 0.25 * period;
      break;
    case 32:
      state.srPhase = 0.5 * period;
      break;
    case 48:
      state.srPhase = 0.75 * period;
      break;
    default:
      throw new Error("invalid S45ROUND value");
  }
  n &= 15;
  if (n === 0) {
    state.srThreshold = 0;
  } else {
    state.srThreshold = (n / 8 - 0.5) * period;
  }
}
function ROFF(state) {
  if (exports.DEBUG) {
    console.log(state.step, "ROFF[]");
  }
  state.round = roundOff;
}
function RUTG(state) {
  if (exports.DEBUG) {
    console.log(state.step, "RUTG[]");
  }
  state.round = roundUpToGrid;
}
function RDTG(state) {
  if (exports.DEBUG) {
    console.log(state.step, "RDTG[]");
  }
  state.round = roundDownToGrid;
}
function SCANCTRL(state) {
  var n = state.stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "SCANCTRL[]", n);
  }
}
function SDPVTL(a, state) {
  var stack = state.stack;
  var p2i = stack.pop();
  var p1i = stack.pop();
  var p2 = state.z2[p2i];
  var p1 = state.z1[p1i];
  if (exports.DEBUG) {
    console.log(state.step, "SDPVTL[" + a + "]", p2i, p1i);
  }
  var dx;
  var dy;
  if (!a) {
    dx = p1.x - p2.x;
    dy = p1.y - p2.y;
  } else {
    dx = p2.y - p1.y;
    dy = p1.x - p2.x;
  }
  state.dpv = getUnitVector(dx, dy);
}
function GETINFO(state) {
  var stack = state.stack;
  var sel = stack.pop();
  var r = 0;
  if (exports.DEBUG) {
    console.log(state.step, "GETINFO[]", sel);
  }
  if (sel & 1) {
    r = 35;
  }
  if (sel & 32) {
    r |= 4096;
  }
  stack.push(r);
}
function ROLL(state) {
  var stack = state.stack;
  var a = stack.pop();
  var b = stack.pop();
  var c = stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "ROLL[]");
  }
  stack.push(b);
  stack.push(a);
  stack.push(c);
}
function MAX(state) {
  var stack = state.stack;
  var e2 = stack.pop();
  var e1 = stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "MAX[]", e2, e1);
  }
  stack.push(Math.max(e1, e2));
}
function MIN(state) {
  var stack = state.stack;
  var e2 = stack.pop();
  var e1 = stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "MIN[]", e2, e1);
  }
  stack.push(Math.min(e1, e2));
}
function SCANTYPE(state) {
  var n = state.stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "SCANTYPE[]", n);
  }
}
function INSTCTRL(state) {
  var s = state.stack.pop();
  var v = state.stack.pop();
  if (exports.DEBUG) {
    console.log(state.step, "INSTCTRL[]", s, v);
  }
  switch (s) {
    case 1:
      state.inhibitGridFit = !!v;
      return;
    case 2:
      state.ignoreCvt = !!v;
      return;
    default:
      throw new Error("invalid INSTCTRL[] selector");
  }
}
function PUSHB(n, state) {
  var stack = state.stack;
  var prog = state.prog;
  var ip = state.ip;
  if (exports.DEBUG) {
    console.log(state.step, "PUSHB[" + n + "]");
  }
  for (var i = 0; i < n; i++) {
    stack.push(prog[++ip]);
  }
  state.ip = ip;
}
function PUSHW(n, state) {
  var ip = state.ip;
  var prog = state.prog;
  var stack = state.stack;
  if (exports.DEBUG) {
    console.log(state.ip, "PUSHW[" + n + "]");
  }
  for (var i = 0; i < n; i++) {
    var w = prog[++ip] << 8 | prog[++ip];
    if (w & 32768) {
      w = -((w ^ 65535) + 1);
    }
    stack.push(w);
  }
  state.ip = ip;
}
function MDRP_MIRP(indirect, setRp0, keepD, ro, dt, state) {
  var stack = state.stack;
  var cvte = indirect && stack.pop();
  var pi = stack.pop();
  var rp0i = state.rp0;
  var rp = state.z0[rp0i];
  var p = state.z1[pi];
  var md = state.minDis;
  var fv = state.fv;
  var pv = state.dpv;
  var od;
  var d;
  var sign;
  var cv;
  d = od = pv.distance(p, rp, true, true);
  sign = d >= 0 ? 1 : -1;
  d = Math.abs(d);
  if (indirect) {
    cv = state.cvt[cvte];
    if (ro && Math.abs(d - cv) < state.cvCutIn) {
      d = cv;
    }
  }
  if (keepD && d < md) {
    d = md;
  }
  if (ro) {
    d = state.round(d);
  }
  fv.setRelative(p, rp, sign * d, pv);
  fv.touch(p);
  if (exports.DEBUG) {
    console.log(
      state.step,
      (indirect ? "MIRP[" : "MDRP[") + (setRp0 ? "M" : "m") + (keepD ? ">" : "_") + (ro ? "R" : "_") + (dt === 0 ? "Gr" : dt === 1 ? "Bl" : dt === 2 ? "Wh" : "") + "]",
      indirect ? cvte + "(" + state.cvt[cvte] + "," + cv + ")" : "",
      pi,
      "(d =",
      od,
      "->",
      sign * d,
      ")"
    );
  }
  state.rp1 = state.rp0;
  state.rp2 = pi;
  if (setRp0) {
    state.rp0 = pi;
  }
}
instructionTable = [
  /* 0x00 */
  SVTCA.bind(void 0, yUnitVector),
  /* 0x01 */
  SVTCA.bind(void 0, xUnitVector),
  /* 0x02 */
  SPVTCA.bind(void 0, yUnitVector),
  /* 0x03 */
  SPVTCA.bind(void 0, xUnitVector),
  /* 0x04 */
  SFVTCA.bind(void 0, yUnitVector),
  /* 0x05 */
  SFVTCA.bind(void 0, xUnitVector),
  /* 0x06 */
  SPVTL.bind(void 0, 0),
  /* 0x07 */
  SPVTL.bind(void 0, 1),
  /* 0x08 */
  SFVTL.bind(void 0, 0),
  /* 0x09 */
  SFVTL.bind(void 0, 1),
  /* 0x0A */
  SPVFS,
  /* 0x0B */
  SFVFS,
  /* 0x0C */
  GPV,
  /* 0x0D */
  GFV,
  /* 0x0E */
  SFVTPV,
  /* 0x0F */
  ISECT,
  /* 0x10 */
  SRP0,
  /* 0x11 */
  SRP1,
  /* 0x12 */
  SRP2,
  /* 0x13 */
  SZP0,
  /* 0x14 */
  SZP1,
  /* 0x15 */
  SZP2,
  /* 0x16 */
  SZPS,
  /* 0x17 */
  SLOOP,
  /* 0x18 */
  RTG,
  /* 0x19 */
  RTHG,
  /* 0x1A */
  SMD,
  /* 0x1B */
  ELSE,
  /* 0x1C */
  JMPR,
  /* 0x1D */
  SCVTCI,
  /* 0x1E */
  void 0,
  // TODO SSWCI
  /* 0x1F */
  void 0,
  // TODO SSW
  /* 0x20 */
  DUP,
  /* 0x21 */
  POP,
  /* 0x22 */
  CLEAR,
  /* 0x23 */
  SWAP,
  /* 0x24 */
  DEPTH,
  /* 0x25 */
  CINDEX,
  /* 0x26 */
  MINDEX,
  /* 0x27 */
  void 0,
  // TODO ALIGNPTS
  /* 0x28 */
  void 0,
  /* 0x29 */
  void 0,
  // TODO UTP
  /* 0x2A */
  LOOPCALL,
  /* 0x2B */
  CALL,
  /* 0x2C */
  FDEF,
  /* 0x2D */
  void 0,
  // ENDF (eaten by FDEF)
  /* 0x2E */
  MDAP.bind(void 0, 0),
  /* 0x2F */
  MDAP.bind(void 0, 1),
  /* 0x30 */
  IUP.bind(void 0, yUnitVector),
  /* 0x31 */
  IUP.bind(void 0, xUnitVector),
  /* 0x32 */
  SHP.bind(void 0, 0),
  /* 0x33 */
  SHP.bind(void 0, 1),
  /* 0x34 */
  SHC.bind(void 0, 0),
  /* 0x35 */
  SHC.bind(void 0, 1),
  /* 0x36 */
  SHZ.bind(void 0, 0),
  /* 0x37 */
  SHZ.bind(void 0, 1),
  /* 0x38 */
  SHPIX,
  /* 0x39 */
  IP,
  /* 0x3A */
  MSIRP.bind(void 0, 0),
  /* 0x3B */
  MSIRP.bind(void 0, 1),
  /* 0x3C */
  ALIGNRP,
  /* 0x3D */
  RTDG,
  /* 0x3E */
  MIAP.bind(void 0, 0),
  /* 0x3F */
  MIAP.bind(void 0, 1),
  /* 0x40 */
  NPUSHB,
  /* 0x41 */
  NPUSHW,
  /* 0x42 */
  WS,
  /* 0x43 */
  RS,
  /* 0x44 */
  WCVTP,
  /* 0x45 */
  RCVT,
  /* 0x46 */
  GC.bind(void 0, 0),
  /* 0x47 */
  GC.bind(void 0, 1),
  /* 0x48 */
  void 0,
  // TODO SCFS
  /* 0x49 */
  MD.bind(void 0, 0),
  /* 0x4A */
  MD.bind(void 0, 1),
  /* 0x4B */
  MPPEM,
  /* 0x4C */
  void 0,
  // TODO MPS
  /* 0x4D */
  FLIPON,
  /* 0x4E */
  void 0,
  // TODO FLIPOFF
  /* 0x4F */
  void 0,
  // TODO DEBUG
  /* 0x50 */
  LT,
  /* 0x51 */
  LTEQ,
  /* 0x52 */
  GT,
  /* 0x53 */
  GTEQ,
  /* 0x54 */
  EQ,
  /* 0x55 */
  NEQ,
  /* 0x56 */
  ODD,
  /* 0x57 */
  EVEN,
  /* 0x58 */
  IF,
  /* 0x59 */
  EIF,
  /* 0x5A */
  AND,
  /* 0x5B */
  OR,
  /* 0x5C */
  NOT,
  /* 0x5D */
  DELTAP123.bind(void 0, 1),
  /* 0x5E */
  SDB,
  /* 0x5F */
  SDS,
  /* 0x60 */
  ADD,
  /* 0x61 */
  SUB,
  /* 0x62 */
  DIV,
  /* 0x63 */
  MUL,
  /* 0x64 */
  ABS,
  /* 0x65 */
  NEG,
  /* 0x66 */
  FLOOR,
  /* 0x67 */
  CEILING,
  /* 0x68 */
  ROUND.bind(void 0, 0),
  /* 0x69 */
  ROUND.bind(void 0, 1),
  /* 0x6A */
  ROUND.bind(void 0, 2),
  /* 0x6B */
  ROUND.bind(void 0, 3),
  /* 0x6C */
  void 0,
  // TODO NROUND[ab]
  /* 0x6D */
  void 0,
  // TODO NROUND[ab]
  /* 0x6E */
  void 0,
  // TODO NROUND[ab]
  /* 0x6F */
  void 0,
  // TODO NROUND[ab]
  /* 0x70 */
  WCVTF,
  /* 0x71 */
  DELTAP123.bind(void 0, 2),
  /* 0x72 */
  DELTAP123.bind(void 0, 3),
  /* 0x73 */
  DELTAC123.bind(void 0, 1),
  /* 0x74 */
  DELTAC123.bind(void 0, 2),
  /* 0x75 */
  DELTAC123.bind(void 0, 3),
  /* 0x76 */
  SROUND,
  /* 0x77 */
  S45ROUND,
  /* 0x78 */
  void 0,
  // TODO JROT[]
  /* 0x79 */
  void 0,
  // TODO JROF[]
  /* 0x7A */
  ROFF,
  /* 0x7B */
  void 0,
  /* 0x7C */
  RUTG,
  /* 0x7D */
  RDTG,
  /* 0x7E */
  POP,
  // actually SANGW, supposed to do only a pop though
  /* 0x7F */
  POP,
  // actually AA, supposed to do only a pop though
  /* 0x80 */
  void 0,
  // TODO FLIPPT
  /* 0x81 */
  void 0,
  // TODO FLIPRGON
  /* 0x82 */
  void 0,
  // TODO FLIPRGOFF
  /* 0x83 */
  void 0,
  /* 0x84 */
  void 0,
  /* 0x85 */
  SCANCTRL,
  /* 0x86 */
  SDPVTL.bind(void 0, 0),
  /* 0x87 */
  SDPVTL.bind(void 0, 1),
  /* 0x88 */
  GETINFO,
  /* 0x89 */
  void 0,
  // TODO IDEF
  /* 0x8A */
  ROLL,
  /* 0x8B */
  MAX,
  /* 0x8C */
  MIN,
  /* 0x8D */
  SCANTYPE,
  /* 0x8E */
  INSTCTRL,
  /* 0x8F */
  void 0,
  /* 0x90 */
  void 0,
  /* 0x91 */
  void 0,
  /* 0x92 */
  void 0,
  /* 0x93 */
  void 0,
  /* 0x94 */
  void 0,
  /* 0x95 */
  void 0,
  /* 0x96 */
  void 0,
  /* 0x97 */
  void 0,
  /* 0x98 */
  void 0,
  /* 0x99 */
  void 0,
  /* 0x9A */
  void 0,
  /* 0x9B */
  void 0,
  /* 0x9C */
  void 0,
  /* 0x9D */
  void 0,
  /* 0x9E */
  void 0,
  /* 0x9F */
  void 0,
  /* 0xA0 */
  void 0,
  /* 0xA1 */
  void 0,
  /* 0xA2 */
  void 0,
  /* 0xA3 */
  void 0,
  /* 0xA4 */
  void 0,
  /* 0xA5 */
  void 0,
  /* 0xA6 */
  void 0,
  /* 0xA7 */
  void 0,
  /* 0xA8 */
  void 0,
  /* 0xA9 */
  void 0,
  /* 0xAA */
  void 0,
  /* 0xAB */
  void 0,
  /* 0xAC */
  void 0,
  /* 0xAD */
  void 0,
  /* 0xAE */
  void 0,
  /* 0xAF */
  void 0,
  /* 0xB0 */
  PUSHB.bind(void 0, 1),
  /* 0xB1 */
  PUSHB.bind(void 0, 2),
  /* 0xB2 */
  PUSHB.bind(void 0, 3),
  /* 0xB3 */
  PUSHB.bind(void 0, 4),
  /* 0xB4 */
  PUSHB.bind(void 0, 5),
  /* 0xB5 */
  PUSHB.bind(void 0, 6),
  /* 0xB6 */
  PUSHB.bind(void 0, 7),
  /* 0xB7 */
  PUSHB.bind(void 0, 8),
  /* 0xB8 */
  PUSHW.bind(void 0, 1),
  /* 0xB9 */
  PUSHW.bind(void 0, 2),
  /* 0xBA */
  PUSHW.bind(void 0, 3),
  /* 0xBB */
  PUSHW.bind(void 0, 4),
  /* 0xBC */
  PUSHW.bind(void 0, 5),
  /* 0xBD */
  PUSHW.bind(void 0, 6),
  /* 0xBE */
  PUSHW.bind(void 0, 7),
  /* 0xBF */
  PUSHW.bind(void 0, 8),
  /* 0xC0 */
  MDRP_MIRP.bind(void 0, 0, 0, 0, 0, 0),
  /* 0xC1 */
  MDRP_MIRP.bind(void 0, 0, 0, 0, 0, 1),
  /* 0xC2 */
  MDRP_MIRP.bind(void 0, 0, 0, 0, 0, 2),
  /* 0xC3 */
  MDRP_MIRP.bind(void 0, 0, 0, 0, 0, 3),
  /* 0xC4 */
  MDRP_MIRP.bind(void 0, 0, 0, 0, 1, 0),
  /* 0xC5 */
  MDRP_MIRP.bind(void 0, 0, 0, 0, 1, 1),
  /* 0xC6 */
  MDRP_MIRP.bind(void 0, 0, 0, 0, 1, 2),
  /* 0xC7 */
  MDRP_MIRP.bind(void 0, 0, 0, 0, 1, 3),
  /* 0xC8 */
  MDRP_MIRP.bind(void 0, 0, 0, 1, 0, 0),
  /* 0xC9 */
  MDRP_MIRP.bind(void 0, 0, 0, 1, 0, 1),
  /* 0xCA */
  MDRP_MIRP.bind(void 0, 0, 0, 1, 0, 2),
  /* 0xCB */
  MDRP_MIRP.bind(void 0, 0, 0, 1, 0, 3),
  /* 0xCC */
  MDRP_MIRP.bind(void 0, 0, 0, 1, 1, 0),
  /* 0xCD */
  MDRP_MIRP.bind(void 0, 0, 0, 1, 1, 1),
  /* 0xCE */
  MDRP_MIRP.bind(void 0, 0, 0, 1, 1, 2),
  /* 0xCF */
  MDRP_MIRP.bind(void 0, 0, 0, 1, 1, 3),
  /* 0xD0 */
  MDRP_MIRP.bind(void 0, 0, 1, 0, 0, 0),
  /* 0xD1 */
  MDRP_MIRP.bind(void 0, 0, 1, 0, 0, 1),
  /* 0xD2 */
  MDRP_MIRP.bind(void 0, 0, 1, 0, 0, 2),
  /* 0xD3 */
  MDRP_MIRP.bind(void 0, 0, 1, 0, 0, 3),
  /* 0xD4 */
  MDRP_MIRP.bind(void 0, 0, 1, 0, 1, 0),
  /* 0xD5 */
  MDRP_MIRP.bind(void 0, 0, 1, 0, 1, 1),
  /* 0xD6 */
  MDRP_MIRP.bind(void 0, 0, 1, 0, 1, 2),
  /* 0xD7 */
  MDRP_MIRP.bind(void 0, 0, 1, 0, 1, 3),
  /* 0xD8 */
  MDRP_MIRP.bind(void 0, 0, 1, 1, 0, 0),
  /* 0xD9 */
  MDRP_MIRP.bind(void 0, 0, 1, 1, 0, 1),
  /* 0xDA */
  MDRP_MIRP.bind(void 0, 0, 1, 1, 0, 2),
  /* 0xDB */
  MDRP_MIRP.bind(void 0, 0, 1, 1, 0, 3),
  /* 0xDC */
  MDRP_MIRP.bind(void 0, 0, 1, 1, 1, 0),
  /* 0xDD */
  MDRP_MIRP.bind(void 0, 0, 1, 1, 1, 1),
  /* 0xDE */
  MDRP_MIRP.bind(void 0, 0, 1, 1, 1, 2),
  /* 0xDF */
  MDRP_MIRP.bind(void 0, 0, 1, 1, 1, 3),
  /* 0xE0 */
  MDRP_MIRP.bind(void 0, 1, 0, 0, 0, 0),
  /* 0xE1 */
  MDRP_MIRP.bind(void 0, 1, 0, 0, 0, 1),
  /* 0xE2 */
  MDRP_MIRP.bind(void 0, 1, 0, 0, 0, 2),
  /* 0xE3 */
  MDRP_MIRP.bind(void 0, 1, 0, 0, 0, 3),
  /* 0xE4 */
  MDRP_MIRP.bind(void 0, 1, 0, 0, 1, 0),
  /* 0xE5 */
  MDRP_MIRP.bind(void 0, 1, 0, 0, 1, 1),
  /* 0xE6 */
  MDRP_MIRP.bind(void 0, 1, 0, 0, 1, 2),
  /* 0xE7 */
  MDRP_MIRP.bind(void 0, 1, 0, 0, 1, 3),
  /* 0xE8 */
  MDRP_MIRP.bind(void 0, 1, 0, 1, 0, 0),
  /* 0xE9 */
  MDRP_MIRP.bind(void 0, 1, 0, 1, 0, 1),
  /* 0xEA */
  MDRP_MIRP.bind(void 0, 1, 0, 1, 0, 2),
  /* 0xEB */
  MDRP_MIRP.bind(void 0, 1, 0, 1, 0, 3),
  /* 0xEC */
  MDRP_MIRP.bind(void 0, 1, 0, 1, 1, 0),
  /* 0xED */
  MDRP_MIRP.bind(void 0, 1, 0, 1, 1, 1),
  /* 0xEE */
  MDRP_MIRP.bind(void 0, 1, 0, 1, 1, 2),
  /* 0xEF */
  MDRP_MIRP.bind(void 0, 1, 0, 1, 1, 3),
  /* 0xF0 */
  MDRP_MIRP.bind(void 0, 1, 1, 0, 0, 0),
  /* 0xF1 */
  MDRP_MIRP.bind(void 0, 1, 1, 0, 0, 1),
  /* 0xF2 */
  MDRP_MIRP.bind(void 0, 1, 1, 0, 0, 2),
  /* 0xF3 */
  MDRP_MIRP.bind(void 0, 1, 1, 0, 0, 3),
  /* 0xF4 */
  MDRP_MIRP.bind(void 0, 1, 1, 0, 1, 0),
  /* 0xF5 */
  MDRP_MIRP.bind(void 0, 1, 1, 0, 1, 1),
  /* 0xF6 */
  MDRP_MIRP.bind(void 0, 1, 1, 0, 1, 2),
  /* 0xF7 */
  MDRP_MIRP.bind(void 0, 1, 1, 0, 1, 3),
  /* 0xF8 */
  MDRP_MIRP.bind(void 0, 1, 1, 1, 0, 0),
  /* 0xF9 */
  MDRP_MIRP.bind(void 0, 1, 1, 1, 0, 1),
  /* 0xFA */
  MDRP_MIRP.bind(void 0, 1, 1, 1, 0, 2),
  /* 0xFB */
  MDRP_MIRP.bind(void 0, 1, 1, 1, 0, 3),
  /* 0xFC */
  MDRP_MIRP.bind(void 0, 1, 1, 1, 1, 0),
  /* 0xFD */
  MDRP_MIRP.bind(void 0, 1, 1, 1, 1, 1),
  /* 0xFE */
  MDRP_MIRP.bind(void 0, 1, 1, 1, 1, 2),
  /* 0xFF */
  MDRP_MIRP.bind(void 0, 1, 1, 1, 1, 3)
];
function Token(char) {
  this.char = char;
  this.state = {};
  this.activeState = null;
}
function ContextRange(startIndex, endOffset, contextName) {
  this.contextName = contextName;
  this.startIndex = startIndex;
  this.endOffset = endOffset;
}
function ContextChecker(contextName, checkStart, checkEnd) {
  this.contextName = contextName;
  this.openRange = null;
  this.ranges = [];
  this.checkStart = checkStart;
  this.checkEnd = checkEnd;
}
function ContextParams(context, currentIndex) {
  this.context = context;
  this.index = currentIndex;
  this.length = context.length;
  this.current = context[currentIndex];
  this.backtrack = context.slice(0, currentIndex);
  this.lookahead = context.slice(currentIndex + 1);
}
function Event(eventId) {
  this.eventId = eventId;
  this.subscribers = [];
}
function initializeCoreEvents(events) {
  var this$1 = this;
  var coreEvents = [
    "start",
    "end",
    "next",
    "newToken",
    "contextStart",
    "contextEnd",
    "insertToken",
    "removeToken",
    "removeRange",
    "replaceToken",
    "replaceRange",
    "composeRUD",
    "updateContextsRanges"
  ];
  coreEvents.forEach(function(eventId) {
    Object.defineProperty(this$1.events, eventId, {
      value: new Event(eventId)
    });
  });
  if (!!events) {
    coreEvents.forEach(function(eventId) {
      var event = events[eventId];
      if (typeof event === "function") {
        this$1.events[eventId].subscribe(event);
      }
    });
  }
  var requiresContextUpdate = [
    "insertToken",
    "removeToken",
    "removeRange",
    "replaceToken",
    "replaceRange",
    "composeRUD"
  ];
  requiresContextUpdate.forEach(function(eventId) {
    this$1.events[eventId].subscribe(
      this$1.updateContextsRanges
    );
  });
}
function Tokenizer(events) {
  this.tokens = [];
  this.registeredContexts = {};
  this.contextCheckers = [];
  this.events = {};
  this.registeredModifiers = [];
  initializeCoreEvents.call(this, events);
}
Token.prototype.setState = function(key, value) {
  this.state[key] = value;
  this.activeState = { key, value: this.state[key] };
  return this.activeState;
};
Token.prototype.getState = function(stateId) {
  return this.state[stateId] || null;
};
Tokenizer.prototype.inboundIndex = function(index) {
  return index >= 0 && index < this.tokens.length;
};
Tokenizer.prototype.composeRUD = function(RUDs) {
  var this$1 = this;
  var silent = true;
  var state = RUDs.map(function(RUD) {
    return this$1[RUD[0]].apply(this$1, RUD.slice(1).concat(silent));
  });
  var hasFAILObject = function(obj) {
    return typeof obj === "object" && obj.hasOwnProperty("FAIL");
  };
  if (state.every(hasFAILObject)) {
    return {
      FAIL: "composeRUD: one or more operations hasn't completed successfully",
      report: state.filter(hasFAILObject)
    };
  }
  this.dispatch("composeRUD", [state.filter(function(op) {
    return !hasFAILObject(op);
  })]);
};
Tokenizer.prototype.replaceRange = function(startIndex, offset, tokens, silent) {
  offset = offset !== null ? offset : this.tokens.length;
  var isTokenType = tokens.every(function(token) {
    return token instanceof Token;
  });
  if (!isNaN(startIndex) && this.inboundIndex(startIndex) && isTokenType) {
    var replaced = this.tokens.splice.apply(
      this.tokens,
      [startIndex, offset].concat(tokens)
    );
    if (!silent) {
      this.dispatch("replaceToken", [startIndex, offset, tokens]);
    }
    return [replaced, tokens];
  } else {
    return { FAIL: "replaceRange: invalid tokens or startIndex." };
  }
};
Tokenizer.prototype.replaceToken = function(index, token, silent) {
  if (!isNaN(index) && this.inboundIndex(index) && token instanceof Token) {
    var replaced = this.tokens.splice(index, 1, token);
    if (!silent) {
      this.dispatch("replaceToken", [index, token]);
    }
    return [replaced[0], token];
  } else {
    return { FAIL: "replaceToken: invalid token or index." };
  }
};
Tokenizer.prototype.removeRange = function(startIndex, offset, silent) {
  offset = !isNaN(offset) ? offset : this.tokens.length;
  var tokens = this.tokens.splice(startIndex, offset);
  if (!silent) {
    this.dispatch("removeRange", [tokens, startIndex, offset]);
  }
  return tokens;
};
Tokenizer.prototype.removeToken = function(index, silent) {
  if (!isNaN(index) && this.inboundIndex(index)) {
    var token = this.tokens.splice(index, 1);
    if (!silent) {
      this.dispatch("removeToken", [token, index]);
    }
    return token;
  } else {
    return { FAIL: "removeToken: invalid token index." };
  }
};
Tokenizer.prototype.insertToken = function(tokens, index, silent) {
  var tokenType = tokens.every(
    function(token) {
      return token instanceof Token;
    }
  );
  if (tokenType) {
    this.tokens.splice.apply(
      this.tokens,
      [index, 0].concat(tokens)
    );
    if (!silent) {
      this.dispatch("insertToken", [tokens, index]);
    }
    return tokens;
  } else {
    return { FAIL: "insertToken: invalid token(s)." };
  }
};
Tokenizer.prototype.registerModifier = function(modifierId, condition, modifier) {
  this.events.newToken.subscribe(function(token, contextParams) {
    var conditionParams = [token, contextParams];
    var canApplyModifier = condition === null || condition.apply(this, conditionParams) === true;
    var modifierParams = [token, contextParams];
    if (canApplyModifier) {
      var newStateValue = modifier.apply(this, modifierParams);
      token.setState(modifierId, newStateValue);
    }
  });
  this.registeredModifiers.push(modifierId);
};
Event.prototype.subscribe = function(eventHandler) {
  if (typeof eventHandler === "function") {
    return this.subscribers.push(eventHandler) - 1;
  } else {
    return { FAIL: "invalid '" + this.eventId + "' event handler" };
  }
};
Event.prototype.unsubscribe = function(subsId) {
  this.subscribers.splice(subsId, 1);
};
ContextParams.prototype.setCurrentIndex = function(index) {
  this.index = index;
  this.current = this.context[index];
  this.backtrack = this.context.slice(0, index);
  this.lookahead = this.context.slice(index + 1);
};
ContextParams.prototype.get = function(offset) {
  switch (true) {
    case offset === 0:
      return this.current;
    case (offset < 0 && Math.abs(offset) <= this.backtrack.length):
      return this.backtrack.slice(offset)[0];
    case (offset > 0 && offset <= this.lookahead.length):
      return this.lookahead[offset - 1];
    default:
      return null;
  }
};
Tokenizer.prototype.rangeToText = function(range) {
  if (range instanceof ContextRange) {
    return this.getRangeTokens(range).map(function(token) {
      return token.char;
    }).join("");
  }
};
Tokenizer.prototype.getText = function() {
  return this.tokens.map(function(token) {
    return token.char;
  }).join("");
};
Tokenizer.prototype.getContext = function(contextName) {
  var context = this.registeredContexts[contextName];
  return !!context ? context : null;
};
Tokenizer.prototype.on = function(eventName, eventHandler) {
  var event = this.events[eventName];
  if (!!event) {
    return event.subscribe(eventHandler);
  } else {
    return null;
  }
};
Tokenizer.prototype.dispatch = function(eventName, args) {
  var this$1 = this;
  var event = this.events[eventName];
  if (event instanceof Event) {
    event.subscribers.forEach(function(subscriber) {
      subscriber.apply(this$1, args || []);
    });
  }
};
Tokenizer.prototype.registerContextChecker = function(contextName, contextStartCheck, contextEndCheck) {
  if (!!this.getContext(contextName)) {
    return {
      FAIL: "context name '" + contextName + "' is already registered."
    };
  }
  if (typeof contextStartCheck !== "function") {
    return {
      FAIL: "missing context start check."
    };
  }
  if (typeof contextEndCheck !== "function") {
    return {
      FAIL: "missing context end check."
    };
  }
  var contextCheckers = new ContextChecker(
    contextName,
    contextStartCheck,
    contextEndCheck
  );
  this.registeredContexts[contextName] = contextCheckers;
  this.contextCheckers.push(contextCheckers);
  return contextCheckers;
};
Tokenizer.prototype.getRangeTokens = function(range) {
  var endIndex = range.startIndex + range.endOffset;
  return [].concat(
    this.tokens.slice(range.startIndex, endIndex)
  );
};
Tokenizer.prototype.getContextRanges = function(contextName) {
  var context = this.getContext(contextName);
  if (!!context) {
    return context.ranges;
  } else {
    return { FAIL: "context checker '" + contextName + "' is not registered." };
  }
};
Tokenizer.prototype.resetContextsRanges = function() {
  var registeredContexts = this.registeredContexts;
  for (var contextName in registeredContexts) {
    if (registeredContexts.hasOwnProperty(contextName)) {
      var context = registeredContexts[contextName];
      context.ranges = [];
    }
  }
};
Tokenizer.prototype.updateContextsRanges = function() {
  this.resetContextsRanges();
  var chars = this.tokens.map(function(token) {
    return token.char;
  });
  for (var i = 0; i < chars.length; i++) {
    var contextParams = new ContextParams(chars, i);
    this.runContextCheck(contextParams);
  }
  this.dispatch("updateContextsRanges", [this.registeredContexts]);
};
Tokenizer.prototype.setEndOffset = function(offset, contextName) {
  var startIndex = this.getContext(contextName).openRange.startIndex;
  var range = new ContextRange(startIndex, offset, contextName);
  var ranges = this.getContext(contextName).ranges;
  range.rangeId = contextName + "." + ranges.length;
  ranges.push(range);
  this.getContext(contextName).openRange = null;
  return range;
};
Tokenizer.prototype.runContextCheck = function(contextParams) {
  var this$1 = this;
  var index = contextParams.index;
  this.contextCheckers.forEach(function(contextChecker) {
    var contextName = contextChecker.contextName;
    var openRange = this$1.getContext(contextName).openRange;
    if (!openRange && contextChecker.checkStart(contextParams)) {
      openRange = new ContextRange(index, null, contextName);
      this$1.getContext(contextName).openRange = openRange;
      this$1.dispatch("contextStart", [contextName, index]);
    }
    if (!!openRange && contextChecker.checkEnd(contextParams)) {
      var offset = index - openRange.startIndex + 1;
      var range = this$1.setEndOffset(offset, contextName);
      this$1.dispatch("contextEnd", [contextName, range]);
    }
  });
};
Tokenizer.prototype.tokenize = function(text) {
  this.tokens = [];
  this.resetContextsRanges();
  var chars = Array.from(text);
  this.dispatch("start");
  for (var i = 0; i < chars.length; i++) {
    var char = chars[i];
    var contextParams = new ContextParams(chars, i);
    this.dispatch("next", [contextParams]);
    this.runContextCheck(contextParams);
    var token = new Token(char);
    this.tokens.push(token);
    this.dispatch("newToken", [token, contextParams]);
  }
  this.dispatch("end", [this.tokens]);
  return this.tokens;
};
function isArabicChar(c) {
  return /[\u0600-\u065F\u066A-\u06D2\u06FA-\u06FF]/.test(c);
}
function isIsolatedArabicChar(char) {
  return /[\u0630\u0690\u0621\u0631\u0661\u0671\u0622\u0632\u0672\u0692\u06C2\u0623\u0673\u0693\u06C3\u0624\u0694\u06C4\u0625\u0675\u0695\u06C5\u06E5\u0676\u0696\u06C6\u0627\u0677\u0697\u06C7\u0648\u0688\u0698\u06C8\u0689\u0699\u06C9\u068A\u06CA\u066B\u068B\u06CB\u068C\u068D\u06CD\u06FD\u068E\u06EE\u06FE\u062F\u068F\u06CF\u06EF]/.test(char);
}
function isTashkeelArabicChar(char) {
  return /[\u0600-\u0605\u060C-\u060E\u0610-\u061B\u061E\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED]/.test(char);
}
function isLatinChar(c) {
  return /[A-z]/.test(c);
}
function isWhiteSpace(c) {
  return /\s/.test(c);
}
function FeatureQuery(font) {
  this.font = font;
  this.features = {};
}
function SubstitutionAction(action) {
  this.id = action.id;
  this.tag = action.tag;
  this.substitution = action.substitution;
}
function lookupCoverage(glyphIndex, coverage) {
  if (!glyphIndex) {
    return -1;
  }
  switch (coverage.format) {
    case 1:
      return coverage.glyphs.indexOf(glyphIndex);
    case 2:
      var ranges = coverage.ranges;
      for (var i = 0; i < ranges.length; i++) {
        var range = ranges[i];
        if (glyphIndex >= range.start && glyphIndex <= range.end) {
          var offset = glyphIndex - range.start;
          return range.index + offset;
        }
      }
      break;
    default:
      return -1;
  }
  return -1;
}
function singleSubstitutionFormat1(glyphIndex, subtable) {
  var substituteIndex = lookupCoverage(glyphIndex, subtable.coverage);
  if (substituteIndex === -1) {
    return null;
  }
  return glyphIndex + subtable.deltaGlyphId;
}
function singleSubstitutionFormat2(glyphIndex, subtable) {
  var substituteIndex = lookupCoverage(glyphIndex, subtable.coverage);
  if (substituteIndex === -1) {
    return null;
  }
  return subtable.substitute[substituteIndex];
}
function lookupCoverageList(coverageList, contextParams) {
  var lookupList = [];
  for (var i = 0; i < coverageList.length; i++) {
    var coverage = coverageList[i];
    var glyphIndex = contextParams.current;
    glyphIndex = Array.isArray(glyphIndex) ? glyphIndex[0] : glyphIndex;
    var lookupIndex = lookupCoverage(glyphIndex, coverage);
    if (lookupIndex !== -1) {
      lookupList.push(lookupIndex);
    }
  }
  if (lookupList.length !== coverageList.length) {
    return -1;
  }
  return lookupList;
}
function chainingSubstitutionFormat3(contextParams, subtable) {
  var lookupsCount = subtable.inputCoverage.length + subtable.lookaheadCoverage.length + subtable.backtrackCoverage.length;
  if (contextParams.context.length < lookupsCount) {
    return [];
  }
  var inputLookups = lookupCoverageList(
    subtable.inputCoverage,
    contextParams
  );
  if (inputLookups === -1) {
    return [];
  }
  var lookaheadOffset = subtable.inputCoverage.length - 1;
  if (contextParams.lookahead.length < subtable.lookaheadCoverage.length) {
    return [];
  }
  var lookaheadContext = contextParams.lookahead.slice(lookaheadOffset);
  while (lookaheadContext.length && isTashkeelArabicChar(lookaheadContext[0].char)) {
    lookaheadContext.shift();
  }
  var lookaheadParams = new ContextParams(lookaheadContext, 0);
  var lookaheadLookups = lookupCoverageList(
    subtable.lookaheadCoverage,
    lookaheadParams
  );
  var backtrackContext = [].concat(contextParams.backtrack);
  backtrackContext.reverse();
  while (backtrackContext.length && isTashkeelArabicChar(backtrackContext[0].char)) {
    backtrackContext.shift();
  }
  if (backtrackContext.length < subtable.backtrackCoverage.length) {
    return [];
  }
  var backtrackParams = new ContextParams(backtrackContext, 0);
  var backtrackLookups = lookupCoverageList(
    subtable.backtrackCoverage,
    backtrackParams
  );
  var contextRulesMatch = inputLookups.length === subtable.inputCoverage.length && lookaheadLookups.length === subtable.lookaheadCoverage.length && backtrackLookups.length === subtable.backtrackCoverage.length;
  var substitutions = [];
  if (contextRulesMatch) {
    for (var i = 0; i < subtable.lookupRecords.length; i++) {
      var lookupRecord = subtable.lookupRecords[i];
      var lookupListIndex = lookupRecord.lookupListIndex;
      var lookupTable = this.getLookupByIndex(lookupListIndex);
      for (var s = 0; s < lookupTable.subtables.length; s++) {
        var subtable$1 = lookupTable.subtables[s];
        var lookup = this.getLookupMethod(lookupTable, subtable$1);
        var substitutionType = this.getSubstitutionType(lookupTable, subtable$1);
        if (substitutionType === "12") {
          for (var n = 0; n < inputLookups.length; n++) {
            var glyphIndex = contextParams.get(n);
            var substitution = lookup(glyphIndex);
            if (substitution) {
              substitutions.push(substitution);
            }
          }
        }
      }
    }
  }
  return substitutions;
}
function ligatureSubstitutionFormat1(contextParams, subtable) {
  var glyphIndex = contextParams.current;
  var ligSetIndex = lookupCoverage(glyphIndex, subtable.coverage);
  if (ligSetIndex === -1) {
    return null;
  }
  var ligature;
  var ligatureSet = subtable.ligatureSets[ligSetIndex];
  for (var s = 0; s < ligatureSet.length; s++) {
    ligature = ligatureSet[s];
    for (var l = 0; l < ligature.components.length; l++) {
      var lookaheadItem = contextParams.lookahead[l];
      var component = ligature.components[l];
      if (lookaheadItem !== component) {
        break;
      }
      if (l === ligature.components.length - 1) {
        return ligature;
      }
    }
  }
  return null;
}
function decompositionSubstitutionFormat1(glyphIndex, subtable) {
  var substituteIndex = lookupCoverage(glyphIndex, subtable.coverage);
  if (substituteIndex === -1) {
    return null;
  }
  return subtable.sequences[substituteIndex];
}
FeatureQuery.prototype.getDefaultScriptFeaturesIndexes = function() {
  var scripts = this.font.tables.gsub.scripts;
  for (var s = 0; s < scripts.length; s++) {
    var script = scripts[s];
    if (script.tag === "DFLT") {
      return script.script.defaultLangSys.featureIndexes;
    }
  }
  return [];
};
FeatureQuery.prototype.getScriptFeaturesIndexes = function(scriptTag) {
  var tables = this.font.tables;
  if (!tables.gsub) {
    return [];
  }
  if (!scriptTag) {
    return this.getDefaultScriptFeaturesIndexes();
  }
  var scripts = this.font.tables.gsub.scripts;
  for (var i = 0; i < scripts.length; i++) {
    var script = scripts[i];
    if (script.tag === scriptTag && script.script.defaultLangSys) {
      return script.script.defaultLangSys.featureIndexes;
    } else {
      var langSysRecords = script.langSysRecords;
      if (!!langSysRecords) {
        for (var j = 0; j < langSysRecords.length; j++) {
          var langSysRecord = langSysRecords[j];
          if (langSysRecord.tag === scriptTag) {
            var langSys = langSysRecord.langSys;
            return langSys.featureIndexes;
          }
        }
      }
    }
  }
  return this.getDefaultScriptFeaturesIndexes();
};
FeatureQuery.prototype.mapTagsToFeatures = function(features, scriptTag) {
  var tags = {};
  for (var i = 0; i < features.length; i++) {
    var tag = features[i].tag;
    var feature = features[i].feature;
    tags[tag] = feature;
  }
  this.features[scriptTag].tags = tags;
};
FeatureQuery.prototype.getScriptFeatures = function(scriptTag) {
  var features = this.features[scriptTag];
  if (this.features.hasOwnProperty(scriptTag)) {
    return features;
  }
  var featuresIndexes = this.getScriptFeaturesIndexes(scriptTag);
  if (!featuresIndexes) {
    return null;
  }
  var gsub2 = this.font.tables.gsub;
  features = featuresIndexes.map(function(index) {
    return gsub2.features[index];
  });
  this.features[scriptTag] = features;
  this.mapTagsToFeatures(features, scriptTag);
  return features;
};
FeatureQuery.prototype.getSubstitutionType = function(lookupTable, subtable) {
  var lookupType = lookupTable.lookupType.toString();
  var substFormat = subtable.substFormat.toString();
  return lookupType + substFormat;
};
FeatureQuery.prototype.getLookupMethod = function(lookupTable, subtable) {
  var this$1 = this;
  var substitutionType = this.getSubstitutionType(lookupTable, subtable);
  switch (substitutionType) {
    case "11":
      return function(glyphIndex) {
        return singleSubstitutionFormat1.apply(
          this$1,
          [glyphIndex, subtable]
        );
      };
    case "12":
      return function(glyphIndex) {
        return singleSubstitutionFormat2.apply(
          this$1,
          [glyphIndex, subtable]
        );
      };
    case "63":
      return function(contextParams) {
        return chainingSubstitutionFormat3.apply(
          this$1,
          [contextParams, subtable]
        );
      };
    case "41":
      return function(contextParams) {
        return ligatureSubstitutionFormat1.apply(
          this$1,
          [contextParams, subtable]
        );
      };
    case "21":
      return function(glyphIndex) {
        return decompositionSubstitutionFormat1.apply(
          this$1,
          [glyphIndex, subtable]
        );
      };
    default:
      throw new Error(
        "lookupType: " + lookupTable.lookupType + " - substFormat: " + subtable.substFormat + " is not yet supported"
      );
  }
};
FeatureQuery.prototype.lookupFeature = function(query) {
  var contextParams = query.contextParams;
  var currentIndex = contextParams.index;
  var feature = this.getFeature({
    tag: query.tag,
    script: query.script
  });
  if (!feature) {
    return new Error(
      "font '" + this.font.names.fullName.en + "' doesn't support feature '" + query.tag + "' for script '" + query.script + "'."
    );
  }
  var lookups = this.getFeatureLookups(feature);
  var substitutions = [].concat(contextParams.context);
  for (var l = 0; l < lookups.length; l++) {
    var lookupTable = lookups[l];
    var subtables = this.getLookupSubtables(lookupTable);
    for (var s = 0; s < subtables.length; s++) {
      var subtable = subtables[s];
      var substType = this.getSubstitutionType(lookupTable, subtable);
      var lookup = this.getLookupMethod(lookupTable, subtable);
      var substitution = void 0;
      switch (substType) {
        case "11":
          substitution = lookup(contextParams.current);
          if (substitution) {
            substitutions.splice(currentIndex, 1, new SubstitutionAction({
              id: 11,
              tag: query.tag,
              substitution
            }));
          }
          break;
        case "12":
          substitution = lookup(contextParams.current);
          if (substitution) {
            substitutions.splice(currentIndex, 1, new SubstitutionAction({
              id: 12,
              tag: query.tag,
              substitution
            }));
          }
          break;
        case "63":
          substitution = lookup(contextParams);
          if (Array.isArray(substitution) && substitution.length) {
            substitutions.splice(currentIndex, 1, new SubstitutionAction({
              id: 63,
              tag: query.tag,
              substitution
            }));
          }
          break;
        case "41":
          substitution = lookup(contextParams);
          if (substitution) {
            substitutions.splice(currentIndex, 1, new SubstitutionAction({
              id: 41,
              tag: query.tag,
              substitution
            }));
          }
          break;
        case "21":
          substitution = lookup(contextParams.current);
          if (substitution) {
            substitutions.splice(currentIndex, 1, new SubstitutionAction({
              id: 21,
              tag: query.tag,
              substitution
            }));
          }
          break;
      }
      contextParams = new ContextParams(substitutions, currentIndex);
      if (Array.isArray(substitution) && !substitution.length) {
        continue;
      }
      substitution = null;
    }
  }
  return substitutions.length ? substitutions : null;
};
FeatureQuery.prototype.supports = function(query) {
  if (!query.script) {
    return false;
  }
  this.getScriptFeatures(query.script);
  var supportedScript = this.features.hasOwnProperty(query.script);
  if (!query.tag) {
    return supportedScript;
  }
  var supportedFeature = this.features[query.script].some(function(feature) {
    return feature.tag === query.tag;
  });
  return supportedScript && supportedFeature;
};
FeatureQuery.prototype.getLookupSubtables = function(lookupTable) {
  return lookupTable.subtables || null;
};
FeatureQuery.prototype.getLookupByIndex = function(index) {
  var lookups = this.font.tables.gsub.lookups;
  return lookups[index] || null;
};
FeatureQuery.prototype.getFeatureLookups = function(feature) {
  return feature.lookupListIndexes.map(this.getLookupByIndex.bind(this));
};
FeatureQuery.prototype.getFeature = function getFeature(query) {
  if (!this.font) {
    return { FAIL: "No font was found" };
  }
  if (!this.features.hasOwnProperty(query.script)) {
    this.getScriptFeatures(query.script);
  }
  var scriptFeatures = this.features[query.script];
  if (!scriptFeatures) {
    return { FAIL: "No feature for script " + query.script };
  }
  if (!scriptFeatures.tags[query.tag]) {
    return null;
  }
  return this.features[query.script].tags[query.tag];
};
function arabicWordStartCheck(contextParams) {
  var char = contextParams.current;
  var prevChar = contextParams.get(-1);
  return (
    // ? arabic first char
    prevChar === null && isArabicChar(char) || // ? arabic char preceded with a non arabic char
    !isArabicChar(prevChar) && isArabicChar(char)
  );
}
function arabicWordEndCheck(contextParams) {
  var nextChar = contextParams.get(1);
  return (
    // ? last arabic char
    nextChar === null || // ? next char is not arabic
    !isArabicChar(nextChar)
  );
}
var arabicWordCheck = {
  startCheck: arabicWordStartCheck,
  endCheck: arabicWordEndCheck
};
function arabicSentenceStartCheck(contextParams) {
  var char = contextParams.current;
  var prevChar = contextParams.get(-1);
  return (
    // ? an arabic char preceded with a non arabic char
    (isArabicChar(char) || isTashkeelArabicChar(char)) && !isArabicChar(prevChar)
  );
}
function arabicSentenceEndCheck(contextParams) {
  var nextChar = contextParams.get(1);
  switch (true) {
    case nextChar === null:
      return true;
    case (!isArabicChar(nextChar) && !isTashkeelArabicChar(nextChar)):
      var nextIsWhitespace = isWhiteSpace(nextChar);
      if (!nextIsWhitespace) {
        return true;
      }
      if (nextIsWhitespace) {
        var arabicCharAhead = false;
        arabicCharAhead = contextParams.lookahead.some(
          function(c) {
            return isArabicChar(c) || isTashkeelArabicChar(c);
          }
        );
        if (!arabicCharAhead) {
          return true;
        }
      }
      break;
    default:
      return false;
  }
}
var arabicSentenceCheck = {
  startCheck: arabicSentenceStartCheck,
  endCheck: arabicSentenceEndCheck
};
function singleSubstitutionFormat1$1(action, tokens, index) {
  tokens[index].setState(action.tag, action.substitution);
}
function singleSubstitutionFormat2$1(action, tokens, index) {
  tokens[index].setState(action.tag, action.substitution);
}
function chainingSubstitutionFormat3$1(action, tokens, index) {
  action.substitution.forEach(function(subst, offset) {
    var token = tokens[index + offset];
    token.setState(action.tag, subst);
  });
}
function ligatureSubstitutionFormat1$1(action, tokens, index) {
  var token = tokens[index];
  token.setState(action.tag, action.substitution.ligGlyph);
  var compsCount = action.substitution.components.length;
  for (var i = 0; i < compsCount; i++) {
    token = tokens[index + i + 1];
    token.setState("deleted", true);
  }
}
var SUBSTITUTIONS = {
  11: singleSubstitutionFormat1$1,
  12: singleSubstitutionFormat2$1,
  63: chainingSubstitutionFormat3$1,
  41: ligatureSubstitutionFormat1$1
};
function applySubstitution(action, tokens, index) {
  if (action instanceof SubstitutionAction && SUBSTITUTIONS[action.id]) {
    SUBSTITUTIONS[action.id](action, tokens, index);
  }
}
function willConnectPrev(charContextParams) {
  var backtrack = [].concat(charContextParams.backtrack);
  for (var i = backtrack.length - 1; i >= 0; i--) {
    var prevChar = backtrack[i];
    var isolated = isIsolatedArabicChar(prevChar);
    var tashkeel = isTashkeelArabicChar(prevChar);
    if (!isolated && !tashkeel) {
      return true;
    }
    if (isolated) {
      return false;
    }
  }
  return false;
}
function willConnectNext(charContextParams) {
  if (isIsolatedArabicChar(charContextParams.current)) {
    return false;
  }
  for (var i = 0; i < charContextParams.lookahead.length; i++) {
    var nextChar = charContextParams.lookahead[i];
    var tashkeel = isTashkeelArabicChar(nextChar);
    if (!tashkeel) {
      return true;
    }
  }
  return false;
}
function arabicPresentationForms(range) {
  var this$1 = this;
  var script = "arab";
  var tags = this.featuresTags[script];
  var tokens = this.tokenizer.getRangeTokens(range);
  if (tokens.length === 1) {
    return;
  }
  var contextParams = new ContextParams(
    tokens.map(
      function(token) {
        return token.getState("glyphIndex");
      }
    ),
    0
  );
  var charContextParams = new ContextParams(
    tokens.map(
      function(token) {
        return token.char;
      }
    ),
    0
  );
  tokens.forEach(function(token, index) {
    if (isTashkeelArabicChar(token.char)) {
      return;
    }
    contextParams.setCurrentIndex(index);
    charContextParams.setCurrentIndex(index);
    var CONNECT = 0;
    if (willConnectPrev(charContextParams)) {
      CONNECT |= 1;
    }
    if (willConnectNext(charContextParams)) {
      CONNECT |= 2;
    }
    var tag;
    switch (CONNECT) {
      case 1:
        tag = "fina";
        break;
      case 2:
        tag = "init";
        break;
      case 3:
        tag = "medi";
        break;
    }
    if (tags.indexOf(tag) === -1) {
      return;
    }
    var substitutions = this$1.query.lookupFeature({
      tag,
      script,
      contextParams
    });
    if (substitutions instanceof Error) {
      return console.info(substitutions.message);
    }
    substitutions.forEach(function(action, index2) {
      if (action instanceof SubstitutionAction) {
        applySubstitution(action, tokens, index2);
        contextParams.context[index2] = action.substitution;
      }
    });
  });
}
function getContextParams(tokens, index) {
  var context = tokens.map(function(token) {
    return token.activeState.value;
  });
  return new ContextParams(context, index || 0);
}
function arabicRequiredLigatures(range) {
  var this$1 = this;
  var script = "arab";
  var tokens = this.tokenizer.getRangeTokens(range);
  var contextParams = getContextParams(tokens);
  contextParams.context.forEach(function(glyphIndex, index) {
    contextParams.setCurrentIndex(index);
    var substitutions = this$1.query.lookupFeature({
      tag: "rlig",
      script,
      contextParams
    });
    if (substitutions.length) {
      substitutions.forEach(
        function(action) {
          return applySubstitution(action, tokens, index);
        }
      );
      contextParams = getContextParams(tokens);
    }
  });
}
function latinWordStartCheck(contextParams) {
  var char = contextParams.current;
  var prevChar = contextParams.get(-1);
  return (
    // ? latin first char
    prevChar === null && isLatinChar(char) || // ? latin char preceded with a non latin char
    !isLatinChar(prevChar) && isLatinChar(char)
  );
}
function latinWordEndCheck(contextParams) {
  var nextChar = contextParams.get(1);
  return (
    // ? last latin char
    nextChar === null || // ? next char is not latin
    !isLatinChar(nextChar)
  );
}
var latinWordCheck = {
  startCheck: latinWordStartCheck,
  endCheck: latinWordEndCheck
};
function getContextParams$1(tokens, index) {
  var context = tokens.map(function(token) {
    return token.activeState.value;
  });
  return new ContextParams(context, index || 0);
}
function latinLigature(range) {
  var this$1 = this;
  var script = "latn";
  var tokens = this.tokenizer.getRangeTokens(range);
  var contextParams = getContextParams$1(tokens);
  contextParams.context.forEach(function(glyphIndex, index) {
    contextParams.setCurrentIndex(index);
    var substitutions = this$1.query.lookupFeature({
      tag: "liga",
      script,
      contextParams
    });
    if (substitutions.length) {
      substitutions.forEach(
        function(action) {
          return applySubstitution(action, tokens, index);
        }
      );
      contextParams = getContextParams$1(tokens);
    }
  });
}
function Bidi(baseDir) {
  this.baseDir = baseDir || "ltr";
  this.tokenizer = new Tokenizer();
  this.featuresTags = {};
}
Bidi.prototype.setText = function(text) {
  this.text = text;
};
Bidi.prototype.contextChecks = {
  latinWordCheck,
  arabicWordCheck,
  arabicSentenceCheck
};
function registerContextChecker(checkId) {
  var check2 = this.contextChecks[checkId + "Check"];
  return this.tokenizer.registerContextChecker(
    checkId,
    check2.startCheck,
    check2.endCheck
  );
}
function tokenizeText() {
  registerContextChecker.call(this, "latinWord");
  registerContextChecker.call(this, "arabicWord");
  registerContextChecker.call(this, "arabicSentence");
  return this.tokenizer.tokenize(this.text);
}
function reverseArabicSentences() {
  var this$1 = this;
  var ranges = this.tokenizer.getContextRanges("arabicSentence");
  ranges.forEach(function(range) {
    var rangeTokens = this$1.tokenizer.getRangeTokens(range);
    this$1.tokenizer.replaceRange(
      range.startIndex,
      range.endOffset,
      rangeTokens.reverse()
    );
  });
}
Bidi.prototype.registerFeatures = function(script, tags) {
  var this$1 = this;
  var supportedTags = tags.filter(
    function(tag) {
      return this$1.query.supports({ script, tag });
    }
  );
  if (!this.featuresTags.hasOwnProperty(script)) {
    this.featuresTags[script] = supportedTags;
  } else {
    this.featuresTags[script] = this.featuresTags[script].concat(supportedTags);
  }
};
Bidi.prototype.applyFeatures = function(font, features) {
  if (!font) {
    throw new Error(
      "No valid font was provided to apply features"
    );
  }
  if (!this.query) {
    this.query = new FeatureQuery(font);
  }
  for (var f = 0; f < features.length; f++) {
    var feature = features[f];
    if (!this.query.supports({ script: feature.script })) {
      continue;
    }
    this.registerFeatures(feature.script, feature.tags);
  }
};
Bidi.prototype.registerModifier = function(modifierId, condition, modifier) {
  this.tokenizer.registerModifier(modifierId, condition, modifier);
};
function checkGlyphIndexStatus() {
  if (this.tokenizer.registeredModifiers.indexOf("glyphIndex") === -1) {
    throw new Error(
      "glyphIndex modifier is required to apply arabic presentation features."
    );
  }
}
function applyArabicPresentationForms() {
  var this$1 = this;
  var script = "arab";
  if (!this.featuresTags.hasOwnProperty(script)) {
    return;
  }
  checkGlyphIndexStatus.call(this);
  var ranges = this.tokenizer.getContextRanges("arabicWord");
  ranges.forEach(function(range) {
    arabicPresentationForms.call(this$1, range);
  });
}
function applyArabicRequireLigatures() {
  var this$1 = this;
  var script = "arab";
  if (!this.featuresTags.hasOwnProperty(script)) {
    return;
  }
  var tags = this.featuresTags[script];
  if (tags.indexOf("rlig") === -1) {
    return;
  }
  checkGlyphIndexStatus.call(this);
  var ranges = this.tokenizer.getContextRanges("arabicWord");
  ranges.forEach(function(range) {
    arabicRequiredLigatures.call(this$1, range);
  });
}
function applyLatinLigatures() {
  var this$1 = this;
  var script = "latn";
  if (!this.featuresTags.hasOwnProperty(script)) {
    return;
  }
  var tags = this.featuresTags[script];
  if (tags.indexOf("liga") === -1) {
    return;
  }
  checkGlyphIndexStatus.call(this);
  var ranges = this.tokenizer.getContextRanges("latinWord");
  ranges.forEach(function(range) {
    latinLigature.call(this$1, range);
  });
}
Bidi.prototype.checkContextReady = function(contextId) {
  return !!this.tokenizer.getContext(contextId);
};
Bidi.prototype.applyFeaturesToContexts = function() {
  if (this.checkContextReady("arabicWord")) {
    applyArabicPresentationForms.call(this);
    applyArabicRequireLigatures.call(this);
  }
  if (this.checkContextReady("latinWord")) {
    applyLatinLigatures.call(this);
  }
  if (this.checkContextReady("arabicSentence")) {
    reverseArabicSentences.call(this);
  }
};
Bidi.prototype.processText = function(text) {
  if (!this.text || this.text !== text) {
    this.setText(text);
    tokenizeText.call(this);
    this.applyFeaturesToContexts();
  }
};
Bidi.prototype.getBidiText = function(text) {
  this.processText(text);
  return this.tokenizer.getText();
};
Bidi.prototype.getTextGlyphs = function(text) {
  this.processText(text);
  var indexes = [];
  for (var i = 0; i < this.tokenizer.tokens.length; i++) {
    var token = this.tokenizer.tokens[i];
    if (token.state.deleted) {
      continue;
    }
    var index = token.activeState.value;
    indexes.push(Array.isArray(index) ? index[0] : index);
  }
  return indexes;
};
function Font(options) {
  options = options || {};
  options.tables = options.tables || {};
  if (!options.empty) {
    checkArgument(options.familyName, "When creating a new Font object, familyName is required.");
    checkArgument(options.styleName, "When creating a new Font object, styleName is required.");
    checkArgument(options.unitsPerEm, "When creating a new Font object, unitsPerEm is required.");
    checkArgument(options.ascender, "When creating a new Font object, ascender is required.");
    checkArgument(options.descender <= 0, "When creating a new Font object, negative descender value is required.");
    this.names = {
      fontFamily: { en: options.familyName || " " },
      fontSubfamily: { en: options.styleName || " " },
      fullName: { en: options.fullName || options.familyName + " " + options.styleName },
      // postScriptName may not contain any whitespace
      postScriptName: { en: options.postScriptName || (options.familyName + options.styleName).replace(/\s/g, "") },
      designer: { en: options.designer || " " },
      designerURL: { en: options.designerURL || " " },
      manufacturer: { en: options.manufacturer || " " },
      manufacturerURL: { en: options.manufacturerURL || " " },
      license: { en: options.license || " " },
      licenseURL: { en: options.licenseURL || " " },
      version: { en: options.version || "Version 0.1" },
      description: { en: options.description || " " },
      copyright: { en: options.copyright || " " },
      trademark: { en: options.trademark || " " }
    };
    this.unitsPerEm = options.unitsPerEm || 1e3;
    this.ascender = options.ascender;
    this.descender = options.descender;
    this.createdTimestamp = options.createdTimestamp;
    this.tables = Object.assign(options.tables, {
      os2: Object.assign({
        usWeightClass: options.weightClass || this.usWeightClasses.MEDIUM,
        usWidthClass: options.widthClass || this.usWidthClasses.MEDIUM,
        fsSelection: options.fsSelection || this.fsSelectionValues.REGULAR
      }, options.tables.os2)
    });
  }
  this.supported = true;
  this.glyphs = new glyphset.GlyphSet(this, options.glyphs || []);
  this.encoding = new DefaultEncoding(this);
  this.position = new Position(this);
  this.substitution = new Substitution(this);
  this.tables = this.tables || {};
  this._push = null;
  this._hmtxTableData = {};
  Object.defineProperty(this, "hinting", {
    get: function() {
      if (this._hinting) {
        return this._hinting;
      }
      if (this.outlinesFormat === "truetype") {
        return this._hinting = new Hinting(this);
      }
    }
  });
}
Font.prototype.hasChar = function(c) {
  return this.encoding.charToGlyphIndex(c) !== null;
};
Font.prototype.charToGlyphIndex = function(s) {
  return this.encoding.charToGlyphIndex(s);
};
Font.prototype.charToGlyph = function(c) {
  var glyphIndex = this.charToGlyphIndex(c);
  var glyph = this.glyphs.get(glyphIndex);
  if (!glyph) {
    glyph = this.glyphs.get(0);
  }
  return glyph;
};
Font.prototype.updateFeatures = function(options) {
  return this.defaultRenderOptions.features.map(function(feature) {
    if (feature.script === "latn") {
      return {
        script: "latn",
        tags: feature.tags.filter(function(tag) {
          return options[tag];
        })
      };
    } else {
      return feature;
    }
  });
};
Font.prototype.stringToGlyphs = function(s, options) {
  var this$1 = this;
  var bidi = new Bidi();
  var charToGlyphIndexMod = function(token) {
    return this$1.charToGlyphIndex(token.char);
  };
  bidi.registerModifier("glyphIndex", null, charToGlyphIndexMod);
  var features = options ? this.updateFeatures(options.features) : this.defaultRenderOptions.features;
  bidi.applyFeatures(this, features);
  var indexes = bidi.getTextGlyphs(s);
  var length = indexes.length;
  var glyphs = new Array(length);
  var notdef = this.glyphs.get(0);
  for (var i = 0; i < length; i += 1) {
    glyphs[i] = this.glyphs.get(indexes[i]) || notdef;
  }
  return glyphs;
};
Font.prototype.nameToGlyphIndex = function(name) {
  return this.glyphNames.nameToGlyphIndex(name);
};
Font.prototype.nameToGlyph = function(name) {
  var glyphIndex = this.nameToGlyphIndex(name);
  var glyph = this.glyphs.get(glyphIndex);
  if (!glyph) {
    glyph = this.glyphs.get(0);
  }
  return glyph;
};
Font.prototype.glyphIndexToName = function(gid) {
  if (!this.glyphNames.glyphIndexToName) {
    return "";
  }
  return this.glyphNames.glyphIndexToName(gid);
};
Font.prototype.getKerningValue = function(leftGlyph, rightGlyph) {
  leftGlyph = leftGlyph.index || leftGlyph;
  rightGlyph = rightGlyph.index || rightGlyph;
  var gposKerning = this.position.defaultKerningTables;
  if (gposKerning) {
    return this.position.getKerningValue(gposKerning, leftGlyph, rightGlyph);
  }
  return this.kerningPairs[leftGlyph + "," + rightGlyph] || 0;
};
Font.prototype.defaultRenderOptions = {
  kerning: true,
  features: [
    /**
     * these 4 features are required to render Arabic text properly
     * and shouldn't be turned off when rendering arabic text.
     */
    { script: "arab", tags: ["init", "medi", "fina", "rlig"] },
    { script: "latn", tags: ["liga", "rlig"] }
  ]
};
Font.prototype.forEachGlyph = function(text, x, y, fontSize, options, callback) {
  x = x !== void 0 ? x : 0;
  y = y !== void 0 ? y : 0;
  fontSize = fontSize !== void 0 ? fontSize : 72;
  options = Object.assign({}, this.defaultRenderOptions, options);
  var fontScale = 1 / this.unitsPerEm * fontSize;
  var glyphs = this.stringToGlyphs(text, options);
  var kerningLookups;
  if (options.kerning) {
    var script = options.script || this.position.getDefaultScriptName();
    kerningLookups = this.position.getKerningTables(script, options.language);
  }
  for (var i = 0; i < glyphs.length; i += 1) {
    var glyph = glyphs[i];
    callback.call(this, glyph, x, y, fontSize, options);
    if (glyph.advanceWidth) {
      x += glyph.advanceWidth * fontScale;
    }
    if (options.kerning && i < glyphs.length - 1) {
      var kerningValue = kerningLookups ? this.position.getKerningValue(kerningLookups, glyph.index, glyphs[i + 1].index) : this.getKerningValue(glyph, glyphs[i + 1]);
      x += kerningValue * fontScale;
    }
    if (options.letterSpacing) {
      x += options.letterSpacing * fontSize;
    } else if (options.tracking) {
      x += options.tracking / 1e3 * fontSize;
    }
  }
  return x;
};
Font.prototype.getPath = function(text, x, y, fontSize, options) {
  var fullPath = new Path();
  this.forEachGlyph(text, x, y, fontSize, options, function(glyph, gX, gY, gFontSize) {
    var glyphPath = glyph.getPath(gX, gY, gFontSize, options, this);
    fullPath.extend(glyphPath);
  });
  return fullPath;
};
Font.prototype.getPaths = function(text, x, y, fontSize, options) {
  var glyphPaths = [];
  this.forEachGlyph(text, x, y, fontSize, options, function(glyph, gX, gY, gFontSize) {
    var glyphPath = glyph.getPath(gX, gY, gFontSize, options, this);
    glyphPaths.push(glyphPath);
  });
  return glyphPaths;
};
Font.prototype.getAdvanceWidth = function(text, fontSize, options) {
  return this.forEachGlyph(text, 0, 0, fontSize, options, function() {
  });
};
Font.prototype.draw = function(ctx, text, x, y, fontSize, options) {
  this.getPath(text, x, y, fontSize, options).draw(ctx);
};
Font.prototype.drawPoints = function(ctx, text, x, y, fontSize, options) {
  this.forEachGlyph(text, x, y, fontSize, options, function(glyph, gX, gY, gFontSize) {
    glyph.drawPoints(ctx, gX, gY, gFontSize);
  });
};
Font.prototype.drawMetrics = function(ctx, text, x, y, fontSize, options) {
  this.forEachGlyph(text, x, y, fontSize, options, function(glyph, gX, gY, gFontSize) {
    glyph.drawMetrics(ctx, gX, gY, gFontSize);
  });
};
Font.prototype.getEnglishName = function(name) {
  var translations = this.names[name];
  if (translations) {
    return translations.en;
  }
};
Font.prototype.validate = function() {
  var _this = this;
  function assert(predicate, message) {
  }
  function assertNamePresent(name) {
    var englishName = _this.getEnglishName(name);
    assert(englishName && englishName.trim().length > 0);
  }
  assertNamePresent("fontFamily");
  assertNamePresent("weightName");
  assertNamePresent("manufacturer");
  assertNamePresent("copyright");
  assertNamePresent("version");
  assert(this.unitsPerEm > 0);
};
Font.prototype.toTables = function() {
  return sfnt.fontToTable(this);
};
Font.prototype.toBuffer = function() {
  console.warn("Font.toBuffer is deprecated. Use Font.toArrayBuffer instead.");
  return this.toArrayBuffer();
};
Font.prototype.toArrayBuffer = function() {
  var sfntTable = this.toTables();
  var bytes = sfntTable.encode();
  var buffer = new ArrayBuffer(bytes.length);
  var intArray = new Uint8Array(buffer);
  for (var i = 0; i < bytes.length; i++) {
    intArray[i] = bytes[i];
  }
  return buffer;
};
Font.prototype.download = function(fileName) {
  var familyName = this.getEnglishName("fontFamily");
  var styleName = this.getEnglishName("fontSubfamily");
  fileName = fileName || familyName.replace(/\s/g, "") + "-" + styleName + ".otf";
  var arrayBuffer = this.toArrayBuffer();
  if (isBrowser()) {
    window.URL = window.URL || window.webkitURL;
    if (window.URL) {
      var dataView = new DataView(arrayBuffer);
      var blob = new Blob([dataView], { type: "font/opentype" });
      var link = document.createElement("a");
      link.href = window.URL.createObjectURL(blob);
      link.download = fileName;
      var event = document.createEvent("MouseEvents");
      event.initEvent("click", true, false);
      link.dispatchEvent(event);
    } else {
      console.warn("Font file could not be downloaded. Try using a different browser.");
    }
  } else {
    var fs = require_fs();
    var buffer = arrayBufferToNodeBuffer(arrayBuffer);
    fs.writeFileSync(fileName, buffer);
  }
};
Font.prototype.fsSelectionValues = {
  ITALIC: 1,
  //1
  UNDERSCORE: 2,
  //2
  NEGATIVE: 4,
  //4
  OUTLINED: 8,
  //8
  STRIKEOUT: 16,
  //16
  BOLD: 32,
  //32
  REGULAR: 64,
  //64
  USER_TYPO_METRICS: 128,
  //128
  WWS: 256,
  //256
  OBLIQUE: 512
  //512
};
Font.prototype.usWidthClasses = {
  ULTRA_CONDENSED: 1,
  EXTRA_CONDENSED: 2,
  CONDENSED: 3,
  SEMI_CONDENSED: 4,
  MEDIUM: 5,
  SEMI_EXPANDED: 6,
  EXPANDED: 7,
  EXTRA_EXPANDED: 8,
  ULTRA_EXPANDED: 9
};
Font.prototype.usWeightClasses = {
  THIN: 100,
  EXTRA_LIGHT: 200,
  LIGHT: 300,
  NORMAL: 400,
  MEDIUM: 500,
  SEMI_BOLD: 600,
  BOLD: 700,
  EXTRA_BOLD: 800,
  BLACK: 900
};
function addName(name, names) {
  var nameString = JSON.stringify(name);
  var nameID = 256;
  for (var nameKey in names) {
    var n = parseInt(nameKey);
    if (!n || n < 256) {
      continue;
    }
    if (JSON.stringify(names[nameKey]) === nameString) {
      return n;
    }
    if (nameID <= n) {
      nameID = n + 1;
    }
  }
  names[nameID] = name;
  return nameID;
}
function makeFvarAxis(n, axis, names) {
  var nameID = addName(axis.name, names);
  return [
    { name: "tag_" + n, type: "TAG", value: axis.tag },
    { name: "minValue_" + n, type: "FIXED", value: axis.minValue << 16 },
    { name: "defaultValue_" + n, type: "FIXED", value: axis.defaultValue << 16 },
    { name: "maxValue_" + n, type: "FIXED", value: axis.maxValue << 16 },
    { name: "flags_" + n, type: "USHORT", value: 0 },
    { name: "nameID_" + n, type: "USHORT", value: nameID }
  ];
}
function parseFvarAxis(data, start, names) {
  var axis = {};
  var p = new parse.Parser(data, start);
  axis.tag = p.parseTag();
  axis.minValue = p.parseFixed();
  axis.defaultValue = p.parseFixed();
  axis.maxValue = p.parseFixed();
  p.skip("uShort", 1);
  axis.name = names[p.parseUShort()] || {};
  return axis;
}
function makeFvarInstance(n, inst, axes, names) {
  var nameID = addName(inst.name, names);
  var fields = [
    { name: "nameID_" + n, type: "USHORT", value: nameID },
    { name: "flags_" + n, type: "USHORT", value: 0 }
  ];
  for (var i = 0; i < axes.length; ++i) {
    var axisTag = axes[i].tag;
    fields.push({
      name: "axis_" + n + " " + axisTag,
      type: "FIXED",
      value: inst.coordinates[axisTag] << 16
    });
  }
  return fields;
}
function parseFvarInstance(data, start, axes, names) {
  var inst = {};
  var p = new parse.Parser(data, start);
  inst.name = names[p.parseUShort()] || {};
  p.skip("uShort", 1);
  inst.coordinates = {};
  for (var i = 0; i < axes.length; ++i) {
    inst.coordinates[axes[i].tag] = p.parseFixed();
  }
  return inst;
}
function makeFvarTable(fvar2, names) {
  var result = new table.Table("fvar", [
    { name: "version", type: "ULONG", value: 65536 },
    { name: "offsetToData", type: "USHORT", value: 0 },
    { name: "countSizePairs", type: "USHORT", value: 2 },
    { name: "axisCount", type: "USHORT", value: fvar2.axes.length },
    { name: "axisSize", type: "USHORT", value: 20 },
    { name: "instanceCount", type: "USHORT", value: fvar2.instances.length },
    { name: "instanceSize", type: "USHORT", value: 4 + fvar2.axes.length * 4 }
  ]);
  result.offsetToData = result.sizeOf();
  for (var i = 0; i < fvar2.axes.length; i++) {
    result.fields = result.fields.concat(makeFvarAxis(i, fvar2.axes[i], names));
  }
  for (var j = 0; j < fvar2.instances.length; j++) {
    result.fields = result.fields.concat(makeFvarInstance(j, fvar2.instances[j], fvar2.axes, names));
  }
  return result;
}
function parseFvarTable(data, start, names) {
  var p = new parse.Parser(data, start);
  var tableVersion = p.parseULong();
  check.argument(tableVersion === 65536, "Unsupported fvar table version.");
  var offsetToData = p.parseOffset16();
  p.skip("uShort", 1);
  var axisCount = p.parseUShort();
  var axisSize = p.parseUShort();
  var instanceCount = p.parseUShort();
  var instanceSize = p.parseUShort();
  var axes = [];
  for (var i = 0; i < axisCount; i++) {
    axes.push(parseFvarAxis(data, start + offsetToData + i * axisSize, names));
  }
  var instances = [];
  var instanceStart = start + offsetToData + axisCount * axisSize;
  for (var j = 0; j < instanceCount; j++) {
    instances.push(parseFvarInstance(data, instanceStart + j * instanceSize, axes, names));
  }
  return { axes, instances };
}
var fvar = { make: makeFvarTable, parse: parseFvarTable };
var attachList = function() {
  return {
    coverage: this.parsePointer(Parser.coverage),
    attachPoints: this.parseList(Parser.pointer(Parser.uShortList))
  };
};
var caretValue = function() {
  var format = this.parseUShort();
  check.argument(
    format === 1 || format === 2 || format === 3,
    "Unsupported CaretValue table version."
  );
  if (format === 1) {
    return { coordinate: this.parseShort() };
  } else if (format === 2) {
    return { pointindex: this.parseShort() };
  } else if (format === 3) {
    return { coordinate: this.parseShort() };
  }
};
var ligGlyph = function() {
  return this.parseList(Parser.pointer(caretValue));
};
var ligCaretList = function() {
  return {
    coverage: this.parsePointer(Parser.coverage),
    ligGlyphs: this.parseList(Parser.pointer(ligGlyph))
  };
};
var markGlyphSets = function() {
  this.parseUShort();
  return this.parseList(Parser.pointer(Parser.coverage));
};
function parseGDEFTable(data, start) {
  start = start || 0;
  var p = new Parser(data, start);
  var tableVersion = p.parseVersion(1);
  check.argument(
    tableVersion === 1 || tableVersion === 1.2 || tableVersion === 1.3,
    "Unsupported GDEF table version."
  );
  var gdef2 = {
    version: tableVersion,
    classDef: p.parsePointer(Parser.classDef),
    attachList: p.parsePointer(attachList),
    ligCaretList: p.parsePointer(ligCaretList),
    markAttachClassDef: p.parsePointer(Parser.classDef)
  };
  if (tableVersion >= 1.2) {
    gdef2.markGlyphSets = p.parsePointer(markGlyphSets);
  }
  return gdef2;
}
var gdef = { parse: parseGDEFTable };
var subtableParsers$1 = new Array(10);
subtableParsers$1[1] = function parseLookup12() {
  var start = this.offset + this.relativeOffset;
  var posformat = this.parseUShort();
  if (posformat === 1) {
    return {
      posFormat: 1,
      coverage: this.parsePointer(Parser.coverage),
      value: this.parseValueRecord()
    };
  } else if (posformat === 2) {
    return {
      posFormat: 2,
      coverage: this.parsePointer(Parser.coverage),
      values: this.parseValueRecordList()
    };
  }
  check.assert(false, "0x" + start.toString(16) + ": GPOS lookup type 1 format must be 1 or 2.");
};
subtableParsers$1[2] = function parseLookup22() {
  var start = this.offset + this.relativeOffset;
  var posFormat = this.parseUShort();
  check.assert(posFormat === 1 || posFormat === 2, "0x" + start.toString(16) + ": GPOS lookup type 2 format must be 1 or 2.");
  var coverage = this.parsePointer(Parser.coverage);
  var valueFormat1 = this.parseUShort();
  var valueFormat2 = this.parseUShort();
  if (posFormat === 1) {
    return {
      posFormat,
      coverage,
      valueFormat1,
      valueFormat2,
      pairSets: this.parseList(Parser.pointer(Parser.list(function() {
        return {
          // pairValueRecord
          secondGlyph: this.parseUShort(),
          value1: this.parseValueRecord(valueFormat1),
          value2: this.parseValueRecord(valueFormat2)
        };
      })))
    };
  } else if (posFormat === 2) {
    var classDef1 = this.parsePointer(Parser.classDef);
    var classDef2 = this.parsePointer(Parser.classDef);
    var class1Count = this.parseUShort();
    var class2Count = this.parseUShort();
    return {
      // Class Pair Adjustment
      posFormat,
      coverage,
      valueFormat1,
      valueFormat2,
      classDef1,
      classDef2,
      class1Count,
      class2Count,
      classRecords: this.parseList(class1Count, Parser.list(class2Count, function() {
        return {
          value1: this.parseValueRecord(valueFormat1),
          value2: this.parseValueRecord(valueFormat2)
        };
      }))
    };
  }
};
subtableParsers$1[3] = function parseLookup32() {
  return { error: "GPOS Lookup 3 not supported" };
};
subtableParsers$1[4] = function parseLookup42() {
  return { error: "GPOS Lookup 4 not supported" };
};
subtableParsers$1[5] = function parseLookup52() {
  return { error: "GPOS Lookup 5 not supported" };
};
subtableParsers$1[6] = function parseLookup62() {
  return { error: "GPOS Lookup 6 not supported" };
};
subtableParsers$1[7] = function parseLookup72() {
  return { error: "GPOS Lookup 7 not supported" };
};
subtableParsers$1[8] = function parseLookup82() {
  return { error: "GPOS Lookup 8 not supported" };
};
subtableParsers$1[9] = function parseLookup9() {
  return { error: "GPOS Lookup 9 not supported" };
};
function parseGposTable(data, start) {
  start = start || 0;
  var p = new Parser(data, start);
  var tableVersion = p.parseVersion(1);
  check.argument(tableVersion === 1 || tableVersion === 1.1, "Unsupported GPOS table version " + tableVersion);
  if (tableVersion === 1) {
    return {
      version: tableVersion,
      scripts: p.parseScriptList(),
      features: p.parseFeatureList(),
      lookups: p.parseLookupList(subtableParsers$1)
    };
  } else {
    return {
      version: tableVersion,
      scripts: p.parseScriptList(),
      features: p.parseFeatureList(),
      lookups: p.parseLookupList(subtableParsers$1),
      variations: p.parseFeatureVariationsList()
    };
  }
}
var subtableMakers$1 = new Array(10);
function makeGposTable(gpos2) {
  return new table.Table("GPOS", [
    { name: "version", type: "ULONG", value: 65536 },
    { name: "scripts", type: "TABLE", value: new table.ScriptList(gpos2.scripts) },
    { name: "features", type: "TABLE", value: new table.FeatureList(gpos2.features) },
    { name: "lookups", type: "TABLE", value: new table.LookupList(gpos2.lookups, subtableMakers$1) }
  ]);
}
var gpos = { parse: parseGposTable, make: makeGposTable };
function parseWindowsKernTable(p) {
  var pairs = {};
  p.skip("uShort");
  var subtableVersion = p.parseUShort();
  check.argument(subtableVersion === 0, "Unsupported kern sub-table version.");
  p.skip("uShort", 2);
  var nPairs = p.parseUShort();
  p.skip("uShort", 3);
  for (var i = 0; i < nPairs; i += 1) {
    var leftIndex = p.parseUShort();
    var rightIndex = p.parseUShort();
    var value = p.parseShort();
    pairs[leftIndex + "," + rightIndex] = value;
  }
  return pairs;
}
function parseMacKernTable(p) {
  var pairs = {};
  p.skip("uShort");
  var nTables = p.parseULong();
  if (nTables > 1) {
    console.warn("Only the first kern subtable is supported.");
  }
  p.skip("uLong");
  var coverage = p.parseUShort();
  var subtableVersion = coverage & 255;
  p.skip("uShort");
  if (subtableVersion === 0) {
    var nPairs = p.parseUShort();
    p.skip("uShort", 3);
    for (var i = 0; i < nPairs; i += 1) {
      var leftIndex = p.parseUShort();
      var rightIndex = p.parseUShort();
      var value = p.parseShort();
      pairs[leftIndex + "," + rightIndex] = value;
    }
  }
  return pairs;
}
function parseKernTable(data, start) {
  var p = new parse.Parser(data, start);
  var tableVersion = p.parseUShort();
  if (tableVersion === 0) {
    return parseWindowsKernTable(p);
  } else if (tableVersion === 1) {
    return parseMacKernTable(p);
  } else {
    throw new Error("Unsupported kern table version (" + tableVersion + ").");
  }
}
var kern = { parse: parseKernTable };
function parseLocaTable(data, start, numGlyphs, shortVersion) {
  var p = new parse.Parser(data, start);
  var parseFn = shortVersion ? p.parseUShort : p.parseULong;
  var glyphOffsets = [];
  for (var i = 0; i < numGlyphs + 1; i += 1) {
    var glyphOffset = parseFn.call(p);
    if (shortVersion) {
      glyphOffset *= 2;
    }
    glyphOffsets.push(glyphOffset);
  }
  return glyphOffsets;
}
var loca = { parse: parseLocaTable };
function loadFromFile(path, callback) {
  var fs = require_fs();
  fs.readFile(path, function(err, buffer) {
    if (err) {
      return callback(err.message);
    }
    callback(null, nodeBufferToArrayBuffer(buffer));
  });
}
function loadFromUrl(url, callback) {
  var request = new XMLHttpRequest();
  request.open("get", url, true);
  request.responseType = "arraybuffer";
  request.onload = function() {
    if (request.response) {
      return callback(null, request.response);
    } else {
      return callback("Font could not be loaded: " + request.statusText);
    }
  };
  request.onerror = function() {
    callback("Font could not be loaded");
  };
  request.send();
}
function parseOpenTypeTableEntries(data, numTables) {
  var tableEntries = [];
  var p = 12;
  for (var i = 0; i < numTables; i += 1) {
    var tag = parse.getTag(data, p);
    var checksum = parse.getULong(data, p + 4);
    var offset = parse.getULong(data, p + 8);
    var length = parse.getULong(data, p + 12);
    tableEntries.push({ tag, checksum, offset, length, compression: false });
    p += 16;
  }
  return tableEntries;
}
function parseWOFFTableEntries(data, numTables) {
  var tableEntries = [];
  var p = 44;
  for (var i = 0; i < numTables; i += 1) {
    var tag = parse.getTag(data, p);
    var offset = parse.getULong(data, p + 4);
    var compLength = parse.getULong(data, p + 8);
    var origLength = parse.getULong(data, p + 12);
    var compression = void 0;
    if (compLength < origLength) {
      compression = "WOFF";
    } else {
      compression = false;
    }
    tableEntries.push({
      tag,
      offset,
      compression,
      compressedLength: compLength,
      length: origLength
    });
    p += 20;
  }
  return tableEntries;
}
function uncompressTable(data, tableEntry) {
  if (tableEntry.compression === "WOFF") {
    var inBuffer = new Uint8Array(data.buffer, tableEntry.offset + 2, tableEntry.compressedLength - 2);
    var outBuffer = new Uint8Array(tableEntry.length);
    tinyInflate(inBuffer, outBuffer);
    if (outBuffer.byteLength !== tableEntry.length) {
      throw new Error("Decompression error: " + tableEntry.tag + " decompressed length doesn't match recorded length");
    }
    var view = new DataView(outBuffer.buffer, 0);
    return { data: view, offset: 0 };
  } else {
    return { data, offset: tableEntry.offset };
  }
}
function parseBuffer(buffer, opt) {
  opt = opt === void 0 || opt === null ? {} : opt;
  var indexToLocFormat;
  var ltagTable;
  var font = new Font({ empty: true });
  var data = new DataView(buffer, 0);
  var numTables;
  var tableEntries = [];
  var signature = parse.getTag(data, 0);
  if (signature === String.fromCharCode(0, 1, 0, 0) || signature === "true" || signature === "typ1") {
    font.outlinesFormat = "truetype";
    numTables = parse.getUShort(data, 4);
    tableEntries = parseOpenTypeTableEntries(data, numTables);
  } else if (signature === "OTTO") {
    font.outlinesFormat = "cff";
    numTables = parse.getUShort(data, 4);
    tableEntries = parseOpenTypeTableEntries(data, numTables);
  } else if (signature === "wOFF") {
    var flavor = parse.getTag(data, 4);
    if (flavor === String.fromCharCode(0, 1, 0, 0)) {
      font.outlinesFormat = "truetype";
    } else if (flavor === "OTTO") {
      font.outlinesFormat = "cff";
    } else {
      throw new Error("Unsupported OpenType flavor " + signature);
    }
    numTables = parse.getUShort(data, 12);
    tableEntries = parseWOFFTableEntries(data, numTables);
  } else {
    throw new Error("Unsupported OpenType signature " + signature);
  }
  var cffTableEntry;
  var fvarTableEntry;
  var glyfTableEntry;
  var gdefTableEntry;
  var gposTableEntry;
  var gsubTableEntry;
  var hmtxTableEntry;
  var kernTableEntry;
  var locaTableEntry;
  var nameTableEntry;
  var metaTableEntry;
  var p;
  for (var i = 0; i < numTables; i += 1) {
    var tableEntry = tableEntries[i];
    var table2 = void 0;
    switch (tableEntry.tag) {
      case "cmap":
        table2 = uncompressTable(data, tableEntry);
        font.tables.cmap = cmap.parse(table2.data, table2.offset);
        font.encoding = new CmapEncoding(font.tables.cmap);
        break;
      case "cvt ":
        table2 = uncompressTable(data, tableEntry);
        p = new parse.Parser(table2.data, table2.offset);
        font.tables.cvt = p.parseShortList(tableEntry.length / 2);
        break;
      case "fvar":
        fvarTableEntry = tableEntry;
        break;
      case "fpgm":
        table2 = uncompressTable(data, tableEntry);
        p = new parse.Parser(table2.data, table2.offset);
        font.tables.fpgm = p.parseByteList(tableEntry.length);
        break;
      case "head":
        table2 = uncompressTable(data, tableEntry);
        font.tables.head = head.parse(table2.data, table2.offset);
        font.unitsPerEm = font.tables.head.unitsPerEm;
        indexToLocFormat = font.tables.head.indexToLocFormat;
        break;
      case "hhea":
        table2 = uncompressTable(data, tableEntry);
        font.tables.hhea = hhea.parse(table2.data, table2.offset);
        font.ascender = font.tables.hhea.ascender;
        font.descender = font.tables.hhea.descender;
        font.numberOfHMetrics = font.tables.hhea.numberOfHMetrics;
        break;
      case "hmtx":
        hmtxTableEntry = tableEntry;
        break;
      case "ltag":
        table2 = uncompressTable(data, tableEntry);
        ltagTable = ltag.parse(table2.data, table2.offset);
        break;
      case "maxp":
        table2 = uncompressTable(data, tableEntry);
        font.tables.maxp = maxp.parse(table2.data, table2.offset);
        font.numGlyphs = font.tables.maxp.numGlyphs;
        break;
      case "name":
        nameTableEntry = tableEntry;
        break;
      case "OS/2":
        table2 = uncompressTable(data, tableEntry);
        font.tables.os2 = os2.parse(table2.data, table2.offset);
        break;
      case "post":
        table2 = uncompressTable(data, tableEntry);
        font.tables.post = post.parse(table2.data, table2.offset);
        font.glyphNames = new GlyphNames(font.tables.post);
        break;
      case "prep":
        table2 = uncompressTable(data, tableEntry);
        p = new parse.Parser(table2.data, table2.offset);
        font.tables.prep = p.parseByteList(tableEntry.length);
        break;
      case "glyf":
        glyfTableEntry = tableEntry;
        break;
      case "loca":
        locaTableEntry = tableEntry;
        break;
      case "CFF ":
        cffTableEntry = tableEntry;
        break;
      case "kern":
        kernTableEntry = tableEntry;
        break;
      case "GDEF":
        gdefTableEntry = tableEntry;
        break;
      case "GPOS":
        gposTableEntry = tableEntry;
        break;
      case "GSUB":
        gsubTableEntry = tableEntry;
        break;
      case "meta":
        metaTableEntry = tableEntry;
        break;
    }
  }
  var nameTable = uncompressTable(data, nameTableEntry);
  font.tables.name = _name.parse(nameTable.data, nameTable.offset, ltagTable);
  font.names = font.tables.name;
  if (glyfTableEntry && locaTableEntry) {
    var shortVersion = indexToLocFormat === 0;
    var locaTable = uncompressTable(data, locaTableEntry);
    var locaOffsets = loca.parse(locaTable.data, locaTable.offset, font.numGlyphs, shortVersion);
    var glyfTable = uncompressTable(data, glyfTableEntry);
    font.glyphs = glyf.parse(glyfTable.data, glyfTable.offset, locaOffsets, font, opt);
  } else if (cffTableEntry) {
    var cffTable = uncompressTable(data, cffTableEntry);
    cff.parse(cffTable.data, cffTable.offset, font, opt);
  } else {
    throw new Error("Font doesn't contain TrueType or CFF outlines.");
  }
  var hmtxTable = uncompressTable(data, hmtxTableEntry);
  hmtx.parse(font, hmtxTable.data, hmtxTable.offset, font.numberOfHMetrics, font.numGlyphs, font.glyphs, opt);
  addGlyphNames(font, opt);
  if (kernTableEntry) {
    var kernTable = uncompressTable(data, kernTableEntry);
    font.kerningPairs = kern.parse(kernTable.data, kernTable.offset);
  } else {
    font.kerningPairs = {};
  }
  if (gdefTableEntry) {
    var gdefTable = uncompressTable(data, gdefTableEntry);
    font.tables.gdef = gdef.parse(gdefTable.data, gdefTable.offset);
  }
  if (gposTableEntry) {
    var gposTable = uncompressTable(data, gposTableEntry);
    font.tables.gpos = gpos.parse(gposTable.data, gposTable.offset);
    font.position.init();
  }
  if (gsubTableEntry) {
    var gsubTable = uncompressTable(data, gsubTableEntry);
    font.tables.gsub = gsub.parse(gsubTable.data, gsubTable.offset);
  }
  if (fvarTableEntry) {
    var fvarTable = uncompressTable(data, fvarTableEntry);
    font.tables.fvar = fvar.parse(fvarTable.data, fvarTable.offset, font.names);
  }
  if (metaTableEntry) {
    var metaTable = uncompressTable(data, metaTableEntry);
    font.tables.meta = meta.parse(metaTable.data, metaTable.offset);
    font.metas = font.tables.meta;
  }
  return font;
}
function load(url, callback, opt) {
  opt = opt === void 0 || opt === null ? {} : opt;
  var isNode = typeof window === "undefined";
  var loadFn = isNode && !opt.isUrl ? loadFromFile : loadFromUrl;
  return new Promise(function(resolve, reject) {
    loadFn(url, function(err, arrayBuffer) {
      if (err) {
        if (callback) {
          return callback(err);
        } else {
          reject(err);
        }
      }
      var font;
      try {
        font = parseBuffer(arrayBuffer, opt);
      } catch (e) {
        if (callback) {
          return callback(e, null);
        } else {
          reject(e);
        }
      }
      if (callback) {
        return callback(null, font);
      } else {
        resolve(font);
      }
    });
  });
}
function loadSync(url, opt) {
  var fs = require_fs();
  var buffer = fs.readFileSync(url);
  return parseBuffer(nodeBufferToArrayBuffer(buffer), opt);
}
var opentype = /* @__PURE__ */ Object.freeze({
  __proto__: null,
  Font,
  Glyph,
  Path,
  BoundingBox,
  _parse: parse,
  parse: parseBuffer,
  load,
  loadSync
});
var opentype_module_default = opentype;

// src/pdf-dictionary-text.js
function textToBytes(text) {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index) & 255;
  return bytes;
}
function bytesToText(bytes, start, end) {
  let result = "";
  for (let index = start; index < end; index += 1) result += String.fromCharCode(bytes[index]);
  return result;
}
function skipOneValue(bytes, start) {
  if (bytes[start] === 60 && bytes[start + 1] === 60) return skipDictionary(bytes, start);
  if (bytes[start] === 91) return skipArray(bytes, start);
  if (bytes[start] === 40) return readLiteral(bytes, start).end;
  if (bytes[start] === 60) return readHex(bytes, start).end;
  if (bytes[start] === 47) {
    let cursor = start + 1;
    while (isRegular(bytes[cursor])) cursor += 1;
    return cursor;
  }
  if (isRegular(bytes[start])) {
    let cursor = start;
    while (cursor < bytes.length && isRegular(bytes[cursor])) cursor += 1;
    if (/^\d+$/.test(bytesToText(bytes, start, cursor))) {
      const secondStart = skipWhite(bytes, cursor);
      let secondEnd = secondStart;
      while (secondEnd < bytes.length && isRegular(bytes[secondEnd])) secondEnd += 1;
      if (/^\d+$/.test(bytesToText(bytes, secondStart, secondEnd))) {
        const rStart = skipWhite(bytes, secondEnd);
        if (bytes[rStart] === 82 && !isRegular(bytes[rStart + 1])) return rStart + 1;
      }
    }
    return cursor;
  }
  return start + 1;
}
function topLevelValueOffset(text, key) {
  const bytes = textToBytes(text);
  if (bytes[0] !== 60 || bytes[1] !== 60) return void 0;
  const keyToken = `/${key}`;
  let cursor = 2;
  while (true) {
    cursor = skipWhite(bytes, cursor);
    if (cursor >= bytes.length || bytes[cursor] === 62 && bytes[cursor + 1] === 62) return void 0;
    if (bytes[cursor] !== 47) {
      cursor = skipOneValue(bytes, cursor);
      continue;
    }
    const nameStart = cursor;
    cursor += 1;
    while (isRegular(bytes[cursor])) cursor += 1;
    const name = bytesToText(bytes, nameStart, cursor);
    const valueStart = skipWhite(bytes, cursor);
    if (name === keyToken) return valueStart;
    cursor = skipOneValue(bytes, valueStart);
  }
}
function topLevelInteger(text, key) {
  const offset = topLevelValueOffset(text, key);
  if (offset === void 0) return null;
  const bytes = textToBytes(text);
  let end = offset;
  while (end < bytes.length && isRegular(bytes[end])) end += 1;
  return parseStrictInteger(bytesToText(bytes, offset, end));
}
function nameValue(text, key) {
  return text.match(new RegExp(`/${key}\\s*/([A-Za-z0-9_.+-]+)`))?.[1] ?? null;
}
function signedInteger(text, key) {
  const match = text.match(new RegExp(`/${key}\\s+([+-]?\\d+)(?!\\s+\\d+\\s+R)`, "s"));
  return match ? Number(match[1]) : null;
}
function booleanValue(text, key, fallback) {
  const match = text.match(new RegExp(`/${key}\\s+(true|false)`));
  return match ? match[1] === "true" : fallback;
}
function readToken(text, key) {
  if (!text) return void 0;
  const match = text.match(new RegExp(`/${key}\\s+([^\\s()<>\\[\\]{}/%]*)`));
  return match ? match[1] : void 0;
}
function parseStrictInteger(token) {
  if (!/^[+-]?\d+$/.test(token)) return null;
  const value = Number(token);
  return Number.isSafeInteger(value) ? value : null;
}
function namedSubDictionaries(text) {
  if (!text) return [];
  const results = [];
  const nameStart = /\/([A-Za-z0-9_.+-]+)\s*<</g;
  let match;
  while (match = nameStart.exec(text)) {
    const name = match[1];
    const openIndex = nameStart.lastIndex - 2;
    let depth = 0;
    let cursor = openIndex;
    while (cursor < text.length) {
      if (text.startsWith("<<", cursor)) {
        depth += 1;
        cursor += 2;
      } else if (text.startsWith(">>", cursor)) {
        depth -= 1;
        cursor += 2;
        if (depth === 0) break;
      } else {
        cursor += 1;
      }
    }
    results.push({ name, text: text.slice(openIndex, cursor) });
    nameStart.lastIndex = cursor;
  }
  return results;
}
function nestedDictionaryText(text, key) {
  const start = text.match(new RegExp(`/${key}\\s*<<`));
  if (!start) return null;
  const openIndex = start.index + start[0].length - 2;
  let depth = 0;
  let cursor = openIndex;
  while (cursor < text.length) {
    if (text.startsWith("<<", cursor)) {
      depth += 1;
      cursor += 2;
    } else if (text.startsWith(">>", cursor)) {
      depth -= 1;
      cursor += 2;
      if (depth === 0) break;
    } else {
      cursor += 1;
    }
  }
  return text.slice(openIndex, cursor);
}
function readStringToken(bytes, openIndex) {
  return bytes[openIndex] === 40 ? readLiteral(bytes, openIndex) : readHex(bytes, openIndex);
}
function stringValue(text, key) {
  const match = text.match(new RegExp(`/${key}\\s*([(<])`));
  if (!match || match[1] === "<" && text[match.index + match[0].length] === "<") return null;
  const bytes = textToBytes(text);
  const openIndex = match.index + match[0].length - 1;
  return readStringToken(bytes, openIndex).value;
}
function firstIdBytes(trailerText) {
  const match = trailerText.match(/\/ID\s*\[\s*([(<])/);
  if (!match) return null;
  const bytes = textToBytes(trailerText);
  const openIndex = match.index + match[0].length - 1;
  return readStringToken(bytes, openIndex).value;
}

// src/predictor.js
var MAX_ROW_BYTES = 1 << 24;
function readDecodeParmsText(dictionary) {
  const arrayForm = dictionary.match(/\/DecodeParms\s*\[\s*(<<[\s\S]*?>>)\s*\]/)?.[1];
  return arrayForm ?? dictionary.match(/\/DecodeParms\s*(<<[\s\S]*?>>)/)?.[1] ?? null;
}
function parseDecodeParms(dictionary, context = "") {
  const prefix = context ? `${context}: ` : "";
  const text = readDecodeParmsText(dictionary);
  const read = (key, fallback) => {
    const token = readToken(text, key);
    if (token === void 0) return fallback;
    const value = parseStrictInteger(token);
    if (value === null) throw new Error(`${prefix}Predictor has an invalid /${key}`);
    return value;
  };
  return {
    predictor: read("Predictor", 1),
    columns: read("Columns", 1),
    colors: read("Colors", 1),
    bitsPerComponent: read("BitsPerComponent", 8)
  };
}
function requirePositiveInteger(value, name, prefix) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${prefix}Predictor has an invalid /${name}`);
}
var VALID_BITS_PER_COMPONENT = /* @__PURE__ */ new Set([1, 2, 4, 8, 16]);
function requireValidBitsPerComponent(value, prefix) {
  if (!VALID_BITS_PER_COMPONENT.has(value)) throw new Error(`${prefix}Predictor has an invalid /BitsPerComponent: ${value}`);
}
function rowByteCount(columns, colors, bitsPerComponent, prefix) {
  const bitsPerRow = columns * colors * bitsPerComponent;
  if (!Number.isSafeInteger(bitsPerRow)) throw new Error(`${prefix}Predictor row size is out of the safe integer range`);
  const bytes = Math.ceil(bitsPerRow / 8);
  if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new Error(`${prefix}Predictor row size is invalid`);
  if (bytes > MAX_ROW_BYTES) throw new Error(`${prefix}Predictor row size is too large`);
  return bytes;
}
function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const distanceLeft = Math.abs(estimate - left);
  const distanceUp = Math.abs(estimate - up);
  const distanceUpLeft = Math.abs(estimate - upLeft);
  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) return left;
  if (distanceUp <= distanceUpLeft) return up;
  return upLeft;
}
function undoPngPredictor(data, rowBytes, pixelBytes, prefix) {
  const stride = rowBytes + 1;
  if (data.length === 0 || data.length % stride !== 0) {
    throw new Error(`${prefix}PNG predictor row length does not match the stream length`);
  }
  const rowCount = data.length / stride;
  const output = new Uint8Array(rowCount * rowBytes);
  let previousRow = new Uint8Array(rowBytes);
  for (let row = 0; row < rowCount; row += 1) {
    const rowStart = row * stride;
    const filterType = data[rowStart];
    const raw = data.subarray(rowStart + 1, rowStart + stride);
    const current = output.subarray(row * rowBytes, (row + 1) * rowBytes);
    for (let index = 0; index < rowBytes; index += 1) {
      const left = index >= pixelBytes ? current[index - pixelBytes] : 0;
      const up = previousRow[index];
      const upLeft = index >= pixelBytes ? previousRow[index - pixelBytes] : 0;
      let value;
      if (filterType === 0) value = raw[index];
      else if (filterType === 1) value = raw[index] + left;
      else if (filterType === 2) value = raw[index] + up;
      else if (filterType === 3) value = raw[index] + Math.floor((left + up) / 2);
      else if (filterType === 4) value = raw[index] + paeth(left, up, upLeft);
      else throw new Error(`${prefix}Unknown PNG predictor filter type: ${filterType}`);
      current[index] = value & 255;
    }
    previousRow = current;
  }
  return output;
}
function undoTiffPredictor(data, rowBytes, colors, bitsPerComponent, prefix) {
  if (bitsPerComponent !== 8) throw new Error(`${prefix}Unsupported TIFF Predictor BitsPerComponent: ${bitsPerComponent}`);
  if (data.length === 0 || data.length % rowBytes !== 0) {
    throw new Error(`${prefix}TIFF predictor row length does not match the stream length`);
  }
  const output = Uint8Array.from(data);
  const rowCount = output.length / rowBytes;
  for (let row = 0; row < rowCount; row += 1) {
    const start = row * rowBytes;
    for (let index = colors; index < rowBytes; index += 1) {
      output[start + index] = output[start + index] + output[start + index - colors] & 255;
    }
  }
  return output;
}
function reversePredictor(data, dictionary, context = "") {
  const prefix = context ? `${context}: ` : "";
  const { predictor, columns, colors, bitsPerComponent } = parseDecodeParms(dictionary, context);
  if (predictor === 1) return data;
  requirePositiveInteger(columns, "Columns", prefix);
  requirePositiveInteger(colors, "Colors", prefix);
  requirePositiveInteger(bitsPerComponent, "BitsPerComponent", prefix);
  requireValidBitsPerComponent(bitsPerComponent, prefix);
  const rowBytes = rowByteCount(columns, colors, bitsPerComponent, prefix);
  if (predictor === 2) {
    return undoTiffPredictor(data, rowBytes, colors, bitsPerComponent, prefix);
  }
  if (predictor >= 10 && predictor <= 15) {
    const pixelBytes = Math.max(1, Math.ceil(colors * bitsPerComponent / 8));
    return undoPngPredictor(data, rowBytes, pixelBytes, prefix);
  }
  throw new Error(`${prefix}Unsupported /Predictor value: ${predictor}`);
}

// src/flate.js
function filters(dictionary) {
  const array = dictionary.match(/\/Filter\s*\[(.*?)\]/s)?.[1];
  if (array) return [...array.matchAll(/\/([A-Za-z0-9]+)/g)].map((match) => match[1]);
  const single = dictionary.match(/\/Filter\s*\/([A-Za-z0-9]+)/)?.[1];
  return single ? [single] : [];
}
async function transformWithStream(bytes, format, StreamClass) {
  const stream = new Blob([bytes]).stream().pipeThrough(new StreamClass(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function inflate(bytes) {
  if (typeof DecompressionStream === "undefined") throw new Error("FlateDecode requires the browser DecompressionStream API");
  return transformWithStream(bytes, "deflate", DecompressionStream);
}
async function deflate(bytes) {
  if (typeof CompressionStream === "undefined") throw new Error("FlateDecode requires the browser CompressionStream API");
  return transformWithStream(bytes, "deflate", CompressionStream);
}
async function decodeStreamBytes(dictionary, data, context = "") {
  const applied = filters(dictionary);
  if (applied.length === 0) return data;
  if (applied.length === 1 && applied[0] === "FlateDecode") {
    const inflated = await inflate(data);
    return reversePredictor(inflated, dictionary, context);
  }
  const prefix = context ? `${context}: ` : "";
  throw new Error(`${prefix}Unsupported stream filter: ${applied.join(", ")}`);
}

// node_modules/@noble/hashes/esm/utils.js
function isBytes(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
}
function abytes(b, ...lengths2) {
  if (!isBytes(b))
    throw new Error("Uint8Array expected");
  if (lengths2.length > 0 && !lengths2.includes(b.length))
    throw new Error("Uint8Array expected of length " + lengths2 + ", got length=" + b.length);
}
function aexists(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("Hash instance has been destroyed");
  if (checkFinished && instance.finished)
    throw new Error("Hash#digest() has already been called");
}
function aoutput(out, instance) {
  abytes(out);
  const min = instance.outputLen;
  if (out.length < min) {
    throw new Error("digestInto() expects output buffer of length at least " + min);
  }
}
function clean(...arrays) {
  for (let i = 0; i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
function createView(arr) {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
function rotr(word, shift) {
  return word << 32 - shift | word >>> shift;
}
function utf8ToBytes(str) {
  if (typeof str !== "string")
    throw new Error("string expected");
  return new Uint8Array(new TextEncoder().encode(str));
}
function toBytes(data) {
  if (typeof data === "string")
    data = utf8ToBytes(data);
  abytes(data);
  return data;
}
var Hash = class {
};
function createHasher(hashCons) {
  const hashC = (msg) => hashCons().update(toBytes(msg)).digest();
  const tmp = hashCons();
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.create = () => hashCons();
  return hashC;
}

// node_modules/@noble/hashes/esm/_md.js
function setBigUint64(view, byteOffset, value, isLE) {
  if (typeof view.setBigUint64 === "function")
    return view.setBigUint64(byteOffset, value, isLE);
  const _32n2 = BigInt(32);
  const _u32_max = BigInt(4294967295);
  const wh = Number(value >> _32n2 & _u32_max);
  const wl = Number(value & _u32_max);
  const h = isLE ? 4 : 0;
  const l = isLE ? 0 : 4;
  view.setUint32(byteOffset + h, wh, isLE);
  view.setUint32(byteOffset + l, wl, isLE);
}
function Chi(a, b, c) {
  return a & b ^ ~a & c;
}
function Maj(a, b, c) {
  return a & b ^ a & c ^ b & c;
}
var HashMD = class extends Hash {
  constructor(blockLen, outputLen, padOffset, isLE) {
    super();
    this.finished = false;
    this.length = 0;
    this.pos = 0;
    this.destroyed = false;
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.padOffset = padOffset;
    this.isLE = isLE;
    this.buffer = new Uint8Array(blockLen);
    this.view = createView(this.buffer);
  }
  update(data) {
    aexists(this);
    data = toBytes(data);
    abytes(data);
    const { view, buffer, blockLen } = this;
    const len = data.length;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      if (take === blockLen) {
        const dataView = createView(data);
        for (; blockLen <= len - pos; pos += blockLen)
          this.process(dataView, pos);
        continue;
      }
      buffer.set(data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      pos += take;
      if (this.pos === blockLen) {
        this.process(view, 0);
        this.pos = 0;
      }
    }
    this.length += data.length;
    this.roundClean();
    return this;
  }
  digestInto(out) {
    aexists(this);
    aoutput(out, this);
    this.finished = true;
    const { buffer, view, blockLen, isLE } = this;
    let { pos } = this;
    buffer[pos++] = 128;
    clean(this.buffer.subarray(pos));
    if (this.padOffset > blockLen - pos) {
      this.process(view, 0);
      pos = 0;
    }
    for (let i = pos; i < blockLen; i++)
      buffer[i] = 0;
    setBigUint64(view, blockLen - 8, BigInt(this.length * 8), isLE);
    this.process(view, 0);
    const oview = createView(out);
    const len = this.outputLen;
    if (len % 4)
      throw new Error("_sha2: outputLen should be aligned to 32bit");
    const outLen = len / 4;
    const state = this.get();
    if (outLen > state.length)
      throw new Error("_sha2: outputLen bigger than state");
    for (let i = 0; i < outLen; i++)
      oview.setUint32(4 * i, state[i], isLE);
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
  _cloneInto(to) {
    to || (to = new this.constructor());
    to.set(...this.get());
    const { blockLen, buffer, length, finished, destroyed, pos } = this;
    to.destroyed = destroyed;
    to.finished = finished;
    to.length = length;
    to.pos = pos;
    if (length % blockLen)
      to.buffer.set(buffer);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
};
var SHA256_IV = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  3144134277,
  1013904242,
  2773480762,
  1359893119,
  2600822924,
  528734635,
  1541459225
]);
var SHA384_IV = /* @__PURE__ */ Uint32Array.from([
  3418070365,
  3238371032,
  1654270250,
  914150663,
  2438529370,
  812702999,
  355462360,
  4144912697,
  1731405415,
  4290775857,
  2394180231,
  1750603025,
  3675008525,
  1694076839,
  1203062813,
  3204075428
]);
var SHA512_IV = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  4089235720,
  3144134277,
  2227873595,
  1013904242,
  4271175723,
  2773480762,
  1595750129,
  1359893119,
  2917565137,
  2600822924,
  725511199,
  528734635,
  4215389547,
  1541459225,
  327033209
]);

// node_modules/@noble/hashes/esm/_u64.js
var U32_MASK64 = /* @__PURE__ */ BigInt(2 ** 32 - 1);
var _32n = /* @__PURE__ */ BigInt(32);
function fromBig(n, le = false) {
  if (le)
    return { h: Number(n & U32_MASK64), l: Number(n >> _32n & U32_MASK64) };
  return { h: Number(n >> _32n & U32_MASK64) | 0, l: Number(n & U32_MASK64) | 0 };
}
function split(lst, le = false) {
  const len = lst.length;
  let Ah = new Uint32Array(len);
  let Al = new Uint32Array(len);
  for (let i = 0; i < len; i++) {
    const { h, l } = fromBig(lst[i], le);
    [Ah[i], Al[i]] = [h, l];
  }
  return [Ah, Al];
}
var shrSH = (h, _l, s) => h >>> s;
var shrSL = (h, l, s) => h << 32 - s | l >>> s;
var rotrSH = (h, l, s) => h >>> s | l << 32 - s;
var rotrSL = (h, l, s) => h << 32 - s | l >>> s;
var rotrBH = (h, l, s) => h << 64 - s | l >>> s - 32;
var rotrBL = (h, l, s) => h >>> s - 32 | l << 64 - s;
function add(Ah, Al, Bh, Bl) {
  const l = (Al >>> 0) + (Bl >>> 0);
  return { h: Ah + Bh + (l / 2 ** 32 | 0) | 0, l: l | 0 };
}
var add3L = (Al, Bl, Cl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0);
var add3H = (low, Ah, Bh, Ch) => Ah + Bh + Ch + (low / 2 ** 32 | 0) | 0;
var add4L = (Al, Bl, Cl, Dl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0);
var add4H = (low, Ah, Bh, Ch, Dh) => Ah + Bh + Ch + Dh + (low / 2 ** 32 | 0) | 0;
var add5L = (Al, Bl, Cl, Dl, El) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0) + (El >>> 0);
var add5H = (low, Ah, Bh, Ch, Dh, Eh) => Ah + Bh + Ch + Dh + Eh + (low / 2 ** 32 | 0) | 0;

// node_modules/@noble/hashes/esm/sha2.js
var SHA256_K = /* @__PURE__ */ Uint32Array.from([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
var SHA256_W = /* @__PURE__ */ new Uint32Array(64);
var SHA256 = class extends HashMD {
  constructor(outputLen = 32) {
    super(64, outputLen, 8, false);
    this.A = SHA256_IV[0] | 0;
    this.B = SHA256_IV[1] | 0;
    this.C = SHA256_IV[2] | 0;
    this.D = SHA256_IV[3] | 0;
    this.E = SHA256_IV[4] | 0;
    this.F = SHA256_IV[5] | 0;
    this.G = SHA256_IV[6] | 0;
    this.H = SHA256_IV[7] | 0;
  }
  get() {
    const { A, B, C, D, E, F, G, H } = this;
    return [A, B, C, D, E, F, G, H];
  }
  // prettier-ignore
  set(A, B, C, D, E, F, G, H) {
    this.A = A | 0;
    this.B = B | 0;
    this.C = C | 0;
    this.D = D | 0;
    this.E = E | 0;
    this.F = F | 0;
    this.G = G | 0;
    this.H = H | 0;
  }
  process(view, offset) {
    for (let i = 0; i < 16; i++, offset += 4)
      SHA256_W[i] = view.getUint32(offset, false);
    for (let i = 16; i < 64; i++) {
      const W15 = SHA256_W[i - 15];
      const W2 = SHA256_W[i - 2];
      const s0 = rotr(W15, 7) ^ rotr(W15, 18) ^ W15 >>> 3;
      const s1 = rotr(W2, 17) ^ rotr(W2, 19) ^ W2 >>> 10;
      SHA256_W[i] = s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16] | 0;
    }
    let { A, B, C, D, E, F, G, H } = this;
    for (let i = 0; i < 64; i++) {
      const sigma1 = rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25);
      const T1 = H + sigma1 + Chi(E, F, G) + SHA256_K[i] + SHA256_W[i] | 0;
      const sigma0 = rotr(A, 2) ^ rotr(A, 13) ^ rotr(A, 22);
      const T2 = sigma0 + Maj(A, B, C) | 0;
      H = G;
      G = F;
      F = E;
      E = D + T1 | 0;
      D = C;
      C = B;
      B = A;
      A = T1 + T2 | 0;
    }
    A = A + this.A | 0;
    B = B + this.B | 0;
    C = C + this.C | 0;
    D = D + this.D | 0;
    E = E + this.E | 0;
    F = F + this.F | 0;
    G = G + this.G | 0;
    H = H + this.H | 0;
    this.set(A, B, C, D, E, F, G, H);
  }
  roundClean() {
    clean(SHA256_W);
  }
  destroy() {
    this.set(0, 0, 0, 0, 0, 0, 0, 0);
    clean(this.buffer);
  }
};
var K512 = /* @__PURE__ */ (() => split([
  "0x428a2f98d728ae22",
  "0x7137449123ef65cd",
  "0xb5c0fbcfec4d3b2f",
  "0xe9b5dba58189dbbc",
  "0x3956c25bf348b538",
  "0x59f111f1b605d019",
  "0x923f82a4af194f9b",
  "0xab1c5ed5da6d8118",
  "0xd807aa98a3030242",
  "0x12835b0145706fbe",
  "0x243185be4ee4b28c",
  "0x550c7dc3d5ffb4e2",
  "0x72be5d74f27b896f",
  "0x80deb1fe3b1696b1",
  "0x9bdc06a725c71235",
  "0xc19bf174cf692694",
  "0xe49b69c19ef14ad2",
  "0xefbe4786384f25e3",
  "0x0fc19dc68b8cd5b5",
  "0x240ca1cc77ac9c65",
  "0x2de92c6f592b0275",
  "0x4a7484aa6ea6e483",
  "0x5cb0a9dcbd41fbd4",
  "0x76f988da831153b5",
  "0x983e5152ee66dfab",
  "0xa831c66d2db43210",
  "0xb00327c898fb213f",
  "0xbf597fc7beef0ee4",
  "0xc6e00bf33da88fc2",
  "0xd5a79147930aa725",
  "0x06ca6351e003826f",
  "0x142929670a0e6e70",
  "0x27b70a8546d22ffc",
  "0x2e1b21385c26c926",
  "0x4d2c6dfc5ac42aed",
  "0x53380d139d95b3df",
  "0x650a73548baf63de",
  "0x766a0abb3c77b2a8",
  "0x81c2c92e47edaee6",
  "0x92722c851482353b",
  "0xa2bfe8a14cf10364",
  "0xa81a664bbc423001",
  "0xc24b8b70d0f89791",
  "0xc76c51a30654be30",
  "0xd192e819d6ef5218",
  "0xd69906245565a910",
  "0xf40e35855771202a",
  "0x106aa07032bbd1b8",
  "0x19a4c116b8d2d0c8",
  "0x1e376c085141ab53",
  "0x2748774cdf8eeb99",
  "0x34b0bcb5e19b48a8",
  "0x391c0cb3c5c95a63",
  "0x4ed8aa4ae3418acb",
  "0x5b9cca4f7763e373",
  "0x682e6ff3d6b2b8a3",
  "0x748f82ee5defb2fc",
  "0x78a5636f43172f60",
  "0x84c87814a1f0ab72",
  "0x8cc702081a6439ec",
  "0x90befffa23631e28",
  "0xa4506cebde82bde9",
  "0xbef9a3f7b2c67915",
  "0xc67178f2e372532b",
  "0xca273eceea26619c",
  "0xd186b8c721c0c207",
  "0xeada7dd6cde0eb1e",
  "0xf57d4f7fee6ed178",
  "0x06f067aa72176fba",
  "0x0a637dc5a2c898a6",
  "0x113f9804bef90dae",
  "0x1b710b35131c471b",
  "0x28db77f523047d84",
  "0x32caab7b40c72493",
  "0x3c9ebe0a15c9bebc",
  "0x431d67c49c100d4c",
  "0x4cc5d4becb3e42b6",
  "0x597f299cfc657e2a",
  "0x5fcb6fab3ad6faec",
  "0x6c44198c4a475817"
].map((n) => BigInt(n))))();
var SHA512_Kh = /* @__PURE__ */ (() => K512[0])();
var SHA512_Kl = /* @__PURE__ */ (() => K512[1])();
var SHA512_W_H = /* @__PURE__ */ new Uint32Array(80);
var SHA512_W_L = /* @__PURE__ */ new Uint32Array(80);
var SHA512 = class extends HashMD {
  constructor(outputLen = 64) {
    super(128, outputLen, 16, false);
    this.Ah = SHA512_IV[0] | 0;
    this.Al = SHA512_IV[1] | 0;
    this.Bh = SHA512_IV[2] | 0;
    this.Bl = SHA512_IV[3] | 0;
    this.Ch = SHA512_IV[4] | 0;
    this.Cl = SHA512_IV[5] | 0;
    this.Dh = SHA512_IV[6] | 0;
    this.Dl = SHA512_IV[7] | 0;
    this.Eh = SHA512_IV[8] | 0;
    this.El = SHA512_IV[9] | 0;
    this.Fh = SHA512_IV[10] | 0;
    this.Fl = SHA512_IV[11] | 0;
    this.Gh = SHA512_IV[12] | 0;
    this.Gl = SHA512_IV[13] | 0;
    this.Hh = SHA512_IV[14] | 0;
    this.Hl = SHA512_IV[15] | 0;
  }
  // prettier-ignore
  get() {
    const { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
    return [Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl];
  }
  // prettier-ignore
  set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl) {
    this.Ah = Ah | 0;
    this.Al = Al | 0;
    this.Bh = Bh | 0;
    this.Bl = Bl | 0;
    this.Ch = Ch | 0;
    this.Cl = Cl | 0;
    this.Dh = Dh | 0;
    this.Dl = Dl | 0;
    this.Eh = Eh | 0;
    this.El = El | 0;
    this.Fh = Fh | 0;
    this.Fl = Fl | 0;
    this.Gh = Gh | 0;
    this.Gl = Gl | 0;
    this.Hh = Hh | 0;
    this.Hl = Hl | 0;
  }
  process(view, offset) {
    for (let i = 0; i < 16; i++, offset += 4) {
      SHA512_W_H[i] = view.getUint32(offset);
      SHA512_W_L[i] = view.getUint32(offset += 4);
    }
    for (let i = 16; i < 80; i++) {
      const W15h = SHA512_W_H[i - 15] | 0;
      const W15l = SHA512_W_L[i - 15] | 0;
      const s0h = rotrSH(W15h, W15l, 1) ^ rotrSH(W15h, W15l, 8) ^ shrSH(W15h, W15l, 7);
      const s0l = rotrSL(W15h, W15l, 1) ^ rotrSL(W15h, W15l, 8) ^ shrSL(W15h, W15l, 7);
      const W2h = SHA512_W_H[i - 2] | 0;
      const W2l = SHA512_W_L[i - 2] | 0;
      const s1h = rotrSH(W2h, W2l, 19) ^ rotrBH(W2h, W2l, 61) ^ shrSH(W2h, W2l, 6);
      const s1l = rotrSL(W2h, W2l, 19) ^ rotrBL(W2h, W2l, 61) ^ shrSL(W2h, W2l, 6);
      const SUMl = add4L(s0l, s1l, SHA512_W_L[i - 7], SHA512_W_L[i - 16]);
      const SUMh = add4H(SUMl, s0h, s1h, SHA512_W_H[i - 7], SHA512_W_H[i - 16]);
      SHA512_W_H[i] = SUMh | 0;
      SHA512_W_L[i] = SUMl | 0;
    }
    let { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
    for (let i = 0; i < 80; i++) {
      const sigma1h = rotrSH(Eh, El, 14) ^ rotrSH(Eh, El, 18) ^ rotrBH(Eh, El, 41);
      const sigma1l = rotrSL(Eh, El, 14) ^ rotrSL(Eh, El, 18) ^ rotrBL(Eh, El, 41);
      const CHIh = Eh & Fh ^ ~Eh & Gh;
      const CHIl = El & Fl ^ ~El & Gl;
      const T1ll = add5L(Hl, sigma1l, CHIl, SHA512_Kl[i], SHA512_W_L[i]);
      const T1h = add5H(T1ll, Hh, sigma1h, CHIh, SHA512_Kh[i], SHA512_W_H[i]);
      const T1l = T1ll | 0;
      const sigma0h = rotrSH(Ah, Al, 28) ^ rotrBH(Ah, Al, 34) ^ rotrBH(Ah, Al, 39);
      const sigma0l = rotrSL(Ah, Al, 28) ^ rotrBL(Ah, Al, 34) ^ rotrBL(Ah, Al, 39);
      const MAJh = Ah & Bh ^ Ah & Ch ^ Bh & Ch;
      const MAJl = Al & Bl ^ Al & Cl ^ Bl & Cl;
      Hh = Gh | 0;
      Hl = Gl | 0;
      Gh = Fh | 0;
      Gl = Fl | 0;
      Fh = Eh | 0;
      Fl = El | 0;
      ({ h: Eh, l: El } = add(Dh | 0, Dl | 0, T1h | 0, T1l | 0));
      Dh = Ch | 0;
      Dl = Cl | 0;
      Ch = Bh | 0;
      Cl = Bl | 0;
      Bh = Ah | 0;
      Bl = Al | 0;
      const All = add3L(T1l, sigma0l, MAJl);
      Ah = add3H(All, T1h, sigma0h, MAJh);
      Al = All | 0;
    }
    ({ h: Ah, l: Al } = add(this.Ah | 0, this.Al | 0, Ah | 0, Al | 0));
    ({ h: Bh, l: Bl } = add(this.Bh | 0, this.Bl | 0, Bh | 0, Bl | 0));
    ({ h: Ch, l: Cl } = add(this.Ch | 0, this.Cl | 0, Ch | 0, Cl | 0));
    ({ h: Dh, l: Dl } = add(this.Dh | 0, this.Dl | 0, Dh | 0, Dl | 0));
    ({ h: Eh, l: El } = add(this.Eh | 0, this.El | 0, Eh | 0, El | 0));
    ({ h: Fh, l: Fl } = add(this.Fh | 0, this.Fl | 0, Fh | 0, Fl | 0));
    ({ h: Gh, l: Gl } = add(this.Gh | 0, this.Gl | 0, Gh | 0, Gl | 0));
    ({ h: Hh, l: Hl } = add(this.Hh | 0, this.Hl | 0, Hh | 0, Hl | 0));
    this.set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl);
  }
  roundClean() {
    clean(SHA512_W_H, SHA512_W_L);
  }
  destroy() {
    clean(this.buffer);
    this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  }
};
var SHA384 = class extends SHA512 {
  constructor() {
    super(48);
    this.Ah = SHA384_IV[0] | 0;
    this.Al = SHA384_IV[1] | 0;
    this.Bh = SHA384_IV[2] | 0;
    this.Bl = SHA384_IV[3] | 0;
    this.Ch = SHA384_IV[4] | 0;
    this.Cl = SHA384_IV[5] | 0;
    this.Dh = SHA384_IV[6] | 0;
    this.Dl = SHA384_IV[7] | 0;
    this.Eh = SHA384_IV[8] | 0;
    this.El = SHA384_IV[9] | 0;
    this.Fh = SHA384_IV[10] | 0;
    this.Fl = SHA384_IV[11] | 0;
    this.Gh = SHA384_IV[12] | 0;
    this.Gl = SHA384_IV[13] | 0;
    this.Hh = SHA384_IV[14] | 0;
    this.Hl = SHA384_IV[15] | 0;
  }
};
var sha256 = /* @__PURE__ */ createHasher(() => new SHA256());
var sha512 = /* @__PURE__ */ createHasher(() => new SHA512());
var sha384 = /* @__PURE__ */ createHasher(() => new SHA384());

// node_modules/@noble/hashes/esm/sha256.js
var sha2562 = sha256;

// node_modules/@noble/hashes/esm/sha512.js
var sha5122 = sha512;
var sha3842 = sha384;

// src/sha2.js
var IN_JAVASCRIPT = /* @__PURE__ */ new Map([
  ["SHA-256", sha2562],
  ["SHA-384", sha3842],
  ["SHA-512", sha5122]
]);
async function sha2(algorithm, bytes) {
  const inJavaScript = IN_JAVASCRIPT.get(algorithm);
  if (!inJavaScript) throw new Error(`Unsupported hash algorithm: ${algorithm}`);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return inJavaScript(bytes);
  return new Uint8Array(await subtle.digest(algorithm, bytes));
}
async function sha2563(bytes) {
  return sha2("SHA-256", bytes);
}
async function sha256Hex(bytes) {
  return [...await sha2563(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// src/fallback-font.js
var opentype2 = opentype_module_default.default ?? opentype_module_default;
var encoder = new TextEncoder();
var PDF_UNITS_PER_EM = 1e3;
var MAX_BFCHAR_ENTRIES = 100;
var FALLBACK_FONT_MARKER = "ILPFallbackFont";
async function fingerprintFont(bytes) {
  return sha256Hex(bytes);
}
var hex4 = (value) => value.toString(16).toUpperCase().padStart(4, "0");
function utf16beHex(text) {
  let output = "";
  for (let index = 0; index < text.length; index += 1) output += hex4(text.charCodeAt(index));
  return output;
}
function fontError(code, message, extra = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extra);
  return error;
}
function parseFallbackFont(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let font;
  try {
    font = opentype2.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  } catch (error) {
    throw fontError("FALLBACK_FONT_INVALID", `The fallback font could not be read: ${error.message}`);
  }
  if (font.outlinesFormat !== "truetype") {
    throw fontError("FALLBACK_FONT_INVALID", `The fallback font must have TrueType outlines to be embedded as /FontFile2; this one is ${font.outlinesFormat}`);
  }
  return {
    bytes: data,
    font,
    // Set by setFallbackFont(), which is async and so can hash the program once.
    digest: null,
    unitsPerEm: font.unitsPerEm,
    // A PDF name, so anything outside the printable ASCII a name may hold is dropped.
    postScriptName: (font.names.postScriptName?.en ?? "FallbackFont").replace(/[^\x21-\x7e]|[\s()<>[\]{}/%#]/g, "") || "FallbackFont",
    // Deflating the font is the slowest step in a save and the result never changes, so
    // it is computed once, on first use, and kept.
    compressed: null
  };
}
function glyphsFor(fallback, text) {
  const glyphs = [];
  const missing = [];
  for (const character of text) {
    const glyph = fallback.font.charToGlyph(character);
    if (!glyph || !glyph.index) missing.push(character);
    else glyphs.push({ character, glyphId: glyph.index, advanceWidth: glyph.advanceWidth ?? fallback.unitsPerEm });
  }
  return missing.length ? { missing } : { glyphs };
}
function identityEncode(glyphs) {
  const bytes = new Uint8Array(glyphs.length * 2);
  glyphs.forEach(({ glyphId }, index) => {
    bytes[index * 2] = glyphId >> 8 & 255;
    bytes[index * 2 + 1] = glyphId & 255;
  });
  return bytes;
}
async function buildFallbackFontObjects(fallback, numbers, glyphs, { programAlreadyEmbedded = false } = {}) {
  const { font } = fallback;
  const scale = (value) => Math.round(value * PDF_UNITS_PER_EM / fallback.unitsPerEm);
  const head2 = font.tables.head ?? {};
  const os22 = font.tables.os2 ?? {};
  const drawn = [...glyphs.entries()].sort((a, b) => a[0] - b[0]);
  const widths = drawn.map(([glyphId, { advanceWidth }]) => `${glyphId} [${scale(advanceWidth)}]`).join(" ");
  const bfchar = [];
  for (let start = 0; start < drawn.length; start += MAX_BFCHAR_ENTRIES) {
    const group = drawn.slice(start, start + MAX_BFCHAR_ENTRIES);
    bfchar.push(`${group.length} beginbfchar
${group.map(([glyphId, { character }]) => `<${hex4(glyphId)}> <${utf16beHex(character)}>`).join("\n")}
endbfchar`);
  }
  const toUnicode = `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
${bfchar.join("\n")}
endcmap
CMapName currentdict /CMap defineresource pop
end
end`;
  const toUnicodeData = encoder.encode(toUnicode);
  const name = fallback.postScriptName;
  const descendant = [numbers.cidFont, {
    dictionary: `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${numbers.descriptor} 0 R /DW ${PDF_UNITS_PER_EM} /W [${widths}] /CIDToGIDMap /Identity >>`
  }];
  const unicodeMap = [numbers.toUnicode, {
    dictionary: `<< /Length ${toUnicodeData.length} >>`,
    data: toUnicodeData
  }];
  if (programAlreadyEmbedded) return new Map([descendant, unicodeMap]);
  fallback.compressed ??= await deflate(fallback.bytes);
  const fontData = fallback.compressed;
  return new Map([
    [numbers.type0, {
      dictionary: `<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /Identity-H /DescendantFonts [${numbers.cidFont} 0 R] /ToUnicode ${numbers.toUnicode} 0 R /${FALLBACK_FONT_MARKER} <${fallback.digest}> >>`
    }],
    descendant,
    [numbers.descriptor, {
      dictionary: `<< /Type /FontDescriptor /FontName /${name} /Flags 4 /FontBBox [${scale(head2.xMin ?? 0)} ${scale(head2.yMin ?? 0)} ${scale(head2.xMax ?? 0)} ${scale(head2.yMax ?? 0)}] /ItalicAngle 0 /Ascent ${scale(font.ascender)} /Descent ${scale(font.descender)} /CapHeight ${scale(os22.sCapHeight ?? font.ascender)} /StemV 80 /FontFile2 ${numbers.fontFile} 0 R >>`
    }],
    [numbers.fontFile, {
      dictionary: `<< /Length ${fontData.length} /Length1 ${fallback.bytes.length} /Filter /FlateDecode >>`,
      data: fontData
    }],
    unicodeMap
  ]);
}
function glyphsFromToUnicode(fallback, mappings) {
  const glyphs = /* @__PURE__ */ new Map();
  for (const [code, character] of mappings) {
    const glyphId = Number.parseInt(code, 16);
    if (!Number.isInteger(glyphId) || !glyphId) continue;
    const glyph = fallback.font.glyphs.get(glyphId);
    glyphs.set(glyphId, { character, glyphId, advanceWidth: glyph?.advanceWidth ?? fallback.unitsPerEm });
  }
  return glyphs;
}
function freeResourceName(fontDictionary) {
  const taken = new Set([...fontDictionary.matchAll(/\/([^\s/<>{}[\]()]+)/g)].map((match) => match[1]));
  for (let suffix = 0; ; suffix += 1) {
    const name = suffix ? `ILPFallback${suffix}` : "ILPFallback";
    if (!taken.has(name)) return name;
  }
}

// src/cmap.js
var latin12 = new TextDecoder("latin1");
var MAX_RANGE_LENGTH = 65536;
function utf16be(hex) {
  const units = [];
  for (let index = 0; index < hex.length; index += 4) units.push(Number.parseInt(hex.slice(index, index + 4), 16));
  return String.fromCharCode(...units);
}
function incrementHex(hex, amount) {
  return (BigInt(`0x${hex}`) + BigInt(amount)).toString(16).padStart(hex.length, "0");
}
function parseToUnicodeCMap(bytes) {
  const source = latin12.decode(bytes);
  const mappings = /* @__PURE__ */ new Map();
  for (const block of source.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const match of block[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi)) {
      mappings.set(match[1].toLowerCase(), utf16be(match[2]));
    }
  }
  for (const block of source.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const match of block[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*(?:<([0-9a-f]+)>|\[([^\]]+)\])/gi)) {
      const start = BigInt(`0x${match[1]}`);
      const end = BigInt(`0x${match[2]}`);
      if (end < start || end - start >= BigInt(MAX_RANGE_LENGTH)) continue;
      const destinations = match[4] ? [...match[4].matchAll(/<([0-9a-f]+)>/gi)].map((item) => item[1]) : null;
      for (let offset = 0n; start + offset <= end; offset += 1n) {
        const sourceCode = (start + offset).toString(16).padStart(match[1].length, "0");
        const destination = destinations ? destinations[Number(offset)] : incrementHex(match[3], offset);
        if (destination) mappings.set(sourceCode, utf16be(destination));
      }
    }
  }
  return mappings;
}
function decodeWithCMap(bytes, mappings) {
  if (!mappings?.size) return latin12.decode(bytes);
  const widths = [...new Set([...mappings.keys()].map((key) => key.length / 2))].sort((a, b) => b - a);
  let output = "";
  for (let cursor = 0; cursor < bytes.length; ) {
    let matched = false;
    for (const width of widths) {
      const key = [...bytes.subarray(cursor, cursor + width)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      if (mappings.has(key)) {
        output += mappings.get(key);
        cursor += width;
        matched = true;
        break;
      }
    }
    if (!matched) {
      output += "\uFFFD";
      cursor += 1;
    }
  }
  return output;
}
function encodeWithCMap(text, mappings) {
  const reverse = new Map([...mappings].map(([bytes, unicode]) => [unicode, bytes]));
  const values = [];
  for (const character of text) {
    const hex = reverse.get(character);
    if (!hex) throw new Error(`The existing PDF font has no ToUnicode code for ${JSON.stringify(character)}`);
    for (let index = 0; index < hex.length; index += 2) values.push(Number.parseInt(hex.slice(index, index + 2), 16));
  }
  return Uint8Array.from(values);
}

// src/object-stream.js
var MAX_OBJECT_COUNT = 1e6;
function readUnsignedInteger(bytes, position) {
  const start = skipWhite(bytes, position);
  let cursor = start;
  while (bytes[cursor] >= 48 && bytes[cursor] <= 57) cursor += 1;
  if (cursor === start) return null;
  let value = 0;
  for (let index = start; index < cursor; index += 1) {
    value = value * 10 + (bytes[index] - 48);
    if (!Number.isSafeInteger(value)) {
      throw new Error("Object stream header contains an object number or offset outside the safe integer range");
    }
  }
  return { value, end: cursor };
}
function parseObjectStream(decodedBytes, { objectCount, firstOffset }) {
  if (!Number.isInteger(objectCount) || objectCount <= 0 || objectCount > MAX_OBJECT_COUNT) {
    throw new Error(`Malformed object stream /N: ${objectCount}`);
  }
  if (!Number.isInteger(firstOffset) || firstOffset < 0) {
    throw new Error(`Malformed object stream /First: ${firstOffset}`);
  }
  if (firstOffset > decodedBytes.length) {
    throw new Error("Malformed object stream /First: beyond the end of the decoded stream");
  }
  const header = [];
  let cursor = 0;
  for (let index = 0; index < objectCount; index += 1) {
    const numberField = cursor < firstOffset ? readUnsignedInteger(decodedBytes, cursor) : null;
    if (!numberField || numberField.end > firstOffset) throw new Error("Object stream header is incomplete");
    const offsetField = readUnsignedInteger(decodedBytes, numberField.end);
    if (!offsetField || offsetField.end > firstOffset) throw new Error("Object stream header is incomplete");
    header.push({ objectNumber: numberField.value, offset: offsetField.value });
    cursor = offsetField.end;
  }
  for (let index = 1; index < header.length; index += 1) {
    if (header[index].offset <= header[index - 1].offset) throw new Error("Object stream body offset is invalid: header offsets are not strictly ascending");
  }
  const entries = [];
  for (let index = 0; index < header.length; index += 1) {
    const { objectNumber, offset } = header[index];
    const absoluteStart = firstOffset + offset;
    if (absoluteStart > decodedBytes.length) throw new Error("Object stream body offset is invalid");
    const nextOffset = index + 1 < header.length ? header[index + 1].offset : decodedBytes.length - firstOffset;
    const absoluteEnd = firstOffset + nextOffset;
    if (absoluteEnd > decodedBytes.length) throw new Error("Object stream body offset is invalid");
    entries.push({ objectNumber, index, offset, bytes: decodedBytes.subarray(absoluteStart, absoluteEnd) });
  }
  return entries;
}

// src/pdf-structure.js
function decodeBinaryString(bytes) {
  const CHUNK = 8192;
  let result = "";
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    result += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return result;
}
function readInteger(bytes, position) {
  const start = skipWhite(bytes, position);
  let cursor = start;
  while (bytes[cursor] >= 48 && bytes[cursor] <= 57) cursor += 1;
  if (cursor === start) throw new Error(`Expected an integer at PDF byte ${start}`);
  return { value: Number(decodeBinaryString(bytes.subarray(start, cursor))), end: cursor };
}
function keywordAt(bytes, position, keyword) {
  return decodeBinaryString(bytes.subarray(position, position + keyword.length)) === keyword;
}
function skipLiteral(bytes, position) {
  let cursor = position + 1;
  let depth = 1;
  while (cursor < bytes.length && depth) {
    if (bytes[cursor] === 92) cursor += 2;
    else {
      if (bytes[cursor] === 40) depth += 1;
      if (bytes[cursor] === 41) depth -= 1;
      cursor += 1;
    }
  }
  if (depth) throw new Error("Unterminated PDF literal string");
  return cursor;
}
function dictionaryEnd(bytes, position) {
  if (bytes[position] !== 60 || bytes[position + 1] !== 60) throw new Error("Expected a PDF dictionary");
  let cursor = position + 2;
  let depth = 1;
  while (cursor < bytes.length && depth) {
    if (bytes[cursor] === 37) cursor = skipWhite(bytes, cursor);
    else if (bytes[cursor] === 40) cursor = skipLiteral(bytes, cursor);
    else if (bytes[cursor] === 60 && bytes[cursor + 1] === 60) {
      depth += 1;
      cursor += 2;
    } else if (bytes[cursor] === 62 && bytes[cursor + 1] === 62) {
      depth -= 1;
      cursor += 2;
    } else if (bytes[cursor] === 60) {
      cursor += 1;
      while (cursor < bytes.length && bytes[cursor] !== 62) cursor += 1;
      cursor += 1;
    } else cursor += 1;
  }
  if (depth) throw new Error("Unterminated PDF dictionary");
  return cursor;
}
function arrayEnd(bytes, position) {
  if (bytes[position] !== 91) throw new Error("Expected a PDF array");
  let cursor = position + 1;
  let depth = 1;
  while (cursor < bytes.length && depth) {
    if (bytes[cursor] === 37) cursor = skipWhite(bytes, cursor);
    else if (bytes[cursor] === 40) cursor = skipLiteral(bytes, cursor);
    else if (bytes[cursor] === 60 && bytes[cursor + 1] === 60) cursor = dictionaryEnd(bytes, cursor);
    else if (bytes[cursor] === 60) {
      cursor += 1;
      while (cursor < bytes.length && bytes[cursor] !== 62) cursor += 1;
      cursor += 1;
    } else if (bytes[cursor] === 91) {
      depth += 1;
      cursor += 1;
    } else if (bytes[cursor] === 93) {
      depth -= 1;
      cursor += 1;
    } else cursor += 1;
  }
  if (depth) throw new Error("Unterminated PDF array");
  return cursor;
}
function extractDictionary(bytes, position) {
  const start = skipWhite(bytes, position);
  if (bytes[start] !== 60 || bytes[start + 1] !== 60) return null;
  const end = dictionaryEnd(bytes, start);
  return { start, end, text: decodeBinaryString(bytes.subarray(start, end)) };
}
function findLastStartXref(bytes) {
  const tailStart = Math.max(0, bytes.length - 8192);
  const tail = decodeBinaryString(bytes.subarray(tailStart));
  const matches = [...tail.matchAll(/startxref\s+(\d+)/g)];
  if (!matches.length) throw new Error("PDF startxref was not found");
  return Number(matches.at(-1)[1]);
}
function parseTrailerDictionary(bytes, position) {
  const start = skipWhite(bytes, position);
  const end = dictionaryEnd(bytes, start);
  return { text: decodeBinaryString(bytes.subarray(start, end)), end };
}
function directInteger(dictionary, key) {
  return Number(dictionary.match(new RegExp(`/${key}\\s+(\\d+)(?!\\s+\\d+\\s+R)`, "s"))?.[1]);
}
function reference(dictionary, key) {
  const match = dictionary.match(new RegExp(`/${key}\\s+(\\d+)\\s+(\\d+)\\s+R`, "s"));
  return match ? { number: Number(match[1]), generation: Number(match[2]) } : null;
}
function parseClassicXrefSection(bytes, cursor) {
  cursor += 4;
  const entries = [];
  while (true) {
    cursor = skipWhite(bytes, cursor);
    if (keywordAt(bytes, cursor, "trailer")) {
      const trailer = parseTrailerDictionary(bytes, cursor + 7).text;
      return { entries, trailer };
    }
    const first = readInteger(bytes, cursor);
    const count = readInteger(bytes, first.end);
    cursor = count.end;
    for (let index = 0; index < count.value; index += 1) {
      cursor = skipWhite(bytes, cursor);
      const lineEnd = (() => {
        let end = cursor;
        while (end < bytes.length && bytes[end] !== 10 && bytes[end] !== 13) end += 1;
        return end;
      })();
      const line2 = decodeBinaryString(bytes.subarray(cursor, lineEnd));
      const match = line2.match(/^(\d{10})\s+(\d{5})\s+([nf])/);
      if (!match) throw new Error(`Malformed xref entry for object ${first.value + index}`);
      entries.push({
        number: first.value + index,
        generation: Number(match[2]),
        offset: Number(match[1]),
        free: match[3] === "f"
      });
      cursor = lineEnd;
    }
  }
}
function readRawStreamObject(bytes, offset) {
  let cursor = skipWhite(bytes, offset);
  const objectNumber = readInteger(bytes, cursor);
  const generation = readInteger(bytes, objectNumber.end);
  cursor = skipWhite(bytes, generation.end);
  if (!keywordAt(bytes, cursor, "obj")) throw new Error(`PDF byte ${offset} does not start an indirect object`);
  cursor += 3;
  const dictionary = extractDictionary(bytes, cursor);
  if (!dictionary) throw new Error("Cross-reference stream object has no dictionary");
  cursor = skipWhite(bytes, dictionary.end);
  if (!keywordAt(bytes, cursor, "stream")) throw new Error("Cross-reference stream object has no stream data");
  cursor += 6;
  if (bytes[cursor] === 13 && bytes[cursor + 1] === 10) cursor += 2;
  else if (bytes[cursor] === 10) cursor += 1;
  else throw new Error("Cross-reference stream must start after an EOL marker");
  const length = directInteger(dictionary.text, "Length");
  if (!Number.isInteger(length) || length < 0) throw new Error("Cross-reference stream has no direct /Length");
  const data = bytes.slice(cursor, cursor + length);
  const afterStream = skipWhite(bytes, cursor + length);
  if (!keywordAt(bytes, afterStream, "endstream")) throw new Error("Cross-reference stream length does not end at endstream");
  return { number: objectNumber.value, generation: generation.value, dictionary: dictionary.text, data };
}
var MAX_XREF_FIELD_WIDTH = 8;
function parseFieldWidths(dictionaryText) {
  const raw = dictionaryText.match(/\/W\s*\[([^\]]*)\]/s)?.[1];
  if (raw === void 0) throw new Error("Cross-reference stream has no /W");
  const widths = raw.trim() ? raw.trim().split(/\s+/).map(Number) : [];
  const valid = widths.length === 3 && widths.every((width) => Number.isInteger(width) && width >= 0 && width <= MAX_XREF_FIELD_WIDTH);
  if (!valid || widths[0] + widths[1] + widths[2] === 0) throw new Error("Cross-reference stream has an invalid /W");
  return widths;
}
function parseIndexPairs(dictionaryText, size) {
  const raw = dictionaryText.match(/\/Index\s*\[([^\]]*)\]/s)?.[1];
  if (raw === void 0) return [[0, size]];
  const numbers = raw.trim() ? raw.trim().split(/\s+/).map(Number) : [];
  if (numbers.length % 2 !== 0 || numbers.some((value) => !Number.isInteger(value))) {
    throw new Error("Cross-reference stream has an invalid /Index");
  }
  const pairs = [];
  let previousEnd = 0;
  for (let cursor = 0; cursor < numbers.length; cursor += 2) {
    const [start, count] = [numbers[cursor], numbers[cursor + 1]];
    const end = start + count;
    if (start < 0 || count < 0 || end > size || start < previousEnd) {
      throw new Error("Cross-reference stream has an invalid /Index");
    }
    pairs.push([start, count]);
    previousEnd = end;
  }
  return pairs;
}
function readBigEndianUint(bytes, offset, width) {
  let value = 0;
  for (let index = 0; index < width; index += 1) value = value * 256 + bytes[offset + index];
  return value;
}
function decodeXrefStreamEntries(decoded, widths, indexPairs) {
  const [typeWidth, field2Width, field3Width] = widths;
  const entrySize = typeWidth + field2Width + field3Width;
  const totalEntries = indexPairs.reduce((sum, [, count]) => sum + count, 0);
  if (decoded.length !== totalEntries * entrySize) {
    throw new Error("Cross-reference stream length does not match /W and /Index");
  }
  const entries = [];
  let cursor = 0;
  for (const [start, count] of indexPairs) {
    for (let offset = 0; offset < count; offset += 1) {
      const type = typeWidth === 0 ? 1 : readBigEndianUint(decoded, cursor, typeWidth);
      const field2 = readBigEndianUint(decoded, cursor + typeWidth, field2Width);
      const field3 = readBigEndianUint(decoded, cursor + typeWidth + field2Width, field3Width);
      cursor += entrySize;
      const number = start + offset;
      if (type === 1) entries.push({ number, free: false, offset: field2, generation: field3 });
      else if (type === 2) entries.push({ number, free: false, compressed: true, streamNumber: field2, indexInStream: field3 });
      else entries.push({ number, free: true });
    }
  }
  return entries;
}
async function parseXrefStreamSection(bytes, offset) {
  const object = readRawStreamObject(bytes, offset);
  if (!/\/Type\s*\/XRef\b/.test(object.dictionary)) throw new Error("Expected a cross-reference stream");
  const decoded = await decodeStreamBytes(object.dictionary, object.data, `xref stream object ${object.number}`);
  const size = directInteger(object.dictionary, "Size");
  if (!Number.isInteger(size) || size < 0) throw new Error("Cross-reference stream has an invalid /Size");
  const widths = parseFieldWidths(object.dictionary);
  const indexPairs = parseIndexPairs(object.dictionary, size);
  const entries = decodeXrefStreamEntries(decoded, widths, indexPairs);
  return { entries, trailer: object.dictionary };
}
async function parseXrefSection(bytes, offset) {
  const cursor = skipWhite(bytes, offset);
  if (keywordAt(bytes, cursor, "xref")) return parseClassicXrefSection(bytes, cursor);
  return parseXrefStreamSection(bytes, cursor);
}
function mergeEntries(entries, decided, sectionEntries) {
  for (const entry of sectionEntries) {
    if (decided.has(entry.number)) continue;
    decided.add(entry.number);
    if (!entry.free) entries.set(entry.number, entry);
  }
}
async function collectXref(bytes) {
  const entries = /* @__PURE__ */ new Map();
  const decided = /* @__PURE__ */ new Set();
  const visited = /* @__PURE__ */ new Set();
  const startXref = findLastStartXref(bytes);
  let offset = startXref;
  let latestTrailer;
  while (offset || !visited.size) {
    if (visited.has(offset)) throw new Error("Circular /Prev chain in PDF trailer");
    visited.add(offset);
    const section = await parseXrefSection(bytes, offset);
    latestTrailer ??= section.trailer;
    mergeEntries(entries, decided, section.entries);
    const hybridOffset = directInteger(section.trailer, "XRefStm");
    if (Number.isInteger(hybridOffset) && hybridOffset >= 0) {
      const hybridSection = await parseXrefStreamSection(bytes, hybridOffset);
      mergeEntries(entries, decided, hybridSection.entries);
    }
    offset = directInteger(section.trailer, "Prev");
    if (!offset) break;
  }
  const root = reference(latestTrailer, "Root");
  const size = directInteger(latestTrailer, "Size");
  if (!root || !size) throw new Error("PDF trailer must contain /Root and /Size");
  const encryptReference = reference(latestTrailer, "Encrypt");
  const idBytes = firstIdBytes(latestTrailer);
  return { entries, root, size, previousXref: startXref, encryptReference, idBytes };
}
function strictObjectStreamInteger(dictionaryText, key, streamNumber) {
  const token = readToken(dictionaryText, key);
  if (token === void 0) throw new Error(`Object stream ${streamNumber} has no /${key}`);
  const value = parseStrictInteger(token);
  if (value === null) throw new Error(`Malformed object stream /${key}: ${token}`);
  return value;
}
function parseReferenceArray(text, key) {
  const array = text.match(new RegExp(`/${key}\\s*\\[(.*?)\\]`, "s"))?.[1];
  if (array) return [...array.matchAll(/(\d+)\s+(\d+)\s+R/g)].map((match) => ({ number: Number(match[1]), generation: Number(match[2]) }));
  const single = reference(text, key);
  return single ? [single] : [];
}
function requireObjectEnd(bytes, valueEnd, streamNumber, objectNumber) {
  if (skipWhite(bytes, valueEnd) !== bytes.length) {
    throw new Error(`Object stream ${streamNumber}: compressed object ${objectNumber} has trailing tokens after its value`);
  }
}
function interpretCompressedObject(entry, streamNumber) {
  const base = { number: entry.objectNumber, generation: 0, dictionary: "", data: null, value: null, rawValue: null };
  const bytes = entry.bytes;
  const start = skipWhite(bytes, 0);
  const byte = bytes[start];
  const end = (valueEnd) => requireObjectEnd(bytes, valueEnd, streamNumber, entry.objectNumber);
  if (byte === 60 && bytes[start + 1] === 60) {
    const dictionary = extractDictionary(bytes, start);
    if (!dictionary) throw new Error(`Object stream ${streamNumber}: malformed dictionary for compressed object ${entry.objectNumber}`);
    if (keywordAt(bytes, skipWhite(bytes, dictionary.end), "stream")) {
      throw new Error(`Object stream ${streamNumber}: compressed object ${entry.objectNumber} is a stream object, which is not permitted inside an Object Stream`);
    }
    end(dictionary.end);
    return { ...base, dictionary: dictionary.text };
  }
  if (byte === 91) {
    const cursor = arrayEnd(bytes, start);
    end(cursor);
    return { ...base, rawValue: decodeBinaryString(bytes.subarray(start, cursor)) };
  }
  if (byte === 47) {
    let cursor = start + 1;
    while (isRegular(bytes[cursor])) cursor += 1;
    end(cursor);
    return { ...base, rawValue: decodeBinaryString(bytes.subarray(start, cursor)) };
  }
  if (byte === 40) {
    const literal = readLiteral(bytes, start);
    end(literal.end);
    return { ...base, rawValue: literal.value };
  }
  if (byte === 60) {
    const hex = readHex(bytes, start);
    end(hex.end);
    return { ...base, rawValue: hex.value };
  }
  if (keywordAt(bytes, start, "true")) {
    end(start + 4);
    return { ...base, value: true };
  }
  if (keywordAt(bytes, start, "false")) {
    end(start + 5);
    return { ...base, value: false };
  }
  if (keywordAt(bytes, start, "null")) {
    end(start + 4);
    return { ...base, value: null, rawValue: "null" };
  }
  if (byte === 43 || byte === 45 || byte === 46 || byte >= 48 && byte <= 57) {
    let cursor = start + (bytes[start] === 43 || bytes[start] === 45 ? 1 : 0);
    while (bytes[cursor] >= 48 && bytes[cursor] <= 57 || bytes[cursor] === 46) cursor += 1;
    const value = Number(decodeBinaryString(bytes.subarray(start, cursor)));
    if (!Number.isFinite(value)) throw new Error(`Object stream ${streamNumber}: malformed number for compressed object ${entry.objectNumber}`);
    end(cursor);
    return { ...base, value };
  }
  throw new Error(
    `Object stream ${streamNumber}: compressed object ${entry.objectNumber} has an unsupported or malformed value (a stream object is never valid inside an Object Stream)`
  );
}
var PdfStructure = class {
  constructor(bytes) {
    this.bytes = bytes;
    this.cache = /* @__PURE__ */ new Map();
    this._xrefReady = null;
    this.objectStreamCache = /* @__PURE__ */ new Map();
  }
  /**
   * Resolves the xref table (classic, an xref stream, or a /Prev-chained mix of
   * both), populating `entries` / `root` / `size` / `previousXref`. An xref stream
   * needs Flate decompression to read, which is asynchronous, so this is lazy:
   * nothing here runs until the first thing that actually needs the table asks for
   * it — keeping `new PdfTextEditor(bytes)` itself synchronous and free of I/O.
   */
  ensureXref() {
    if (!this._xrefReady) {
      this._xrefReady = collectXref(this.bytes).then((xref) => {
        Object.assign(this, xref);
      });
    }
    return this._xrefReady;
  }
  /**
   * Resolves a type 1 (normal indirect) object only -- synchronous, since reading
   * one straight out of `this.bytes` needs no I/O. A type 2 (compressed) object
   * needs its Object Stream decoded first (FlateDecode, Predictor, and possibly
   * AES -- see decodeObjectStream()), which is why that path is async: use
   * resolveObject() instead when a reference might be compressed.
   */
  object(referenceOrNumber) {
    const number = typeof referenceOrNumber === "number" ? referenceOrNumber : referenceOrNumber.number;
    if (this.cache.has(number)) return this.cache.get(number);
    const entry = this.entries.get(number);
    if (!entry) throw new Error(`PDF object ${number} is missing from the xref table`);
    if (entry.compressed) {
      throw new Error(`PDF object ${number} is a compressed object stored in object stream ${entry.streamNumber}; use resolveObject() instead of object() to resolve it`);
    }
    let cursor = skipWhite(this.bytes, entry.offset);
    const objectNumber = readInteger(this.bytes, cursor);
    const generation = readInteger(this.bytes, objectNumber.end);
    cursor = skipWhite(this.bytes, generation.end);
    if (objectNumber.value !== number || !keywordAt(this.bytes, cursor, "obj")) {
      throw new Error(`xref offset for PDF object ${number} is invalid`);
    }
    cursor += 3;
    const dictionary = extractDictionary(this.bytes, cursor);
    const object = { number, generation: generation.value, dictionary: dictionary?.text ?? "", data: null, value: null };
    if (dictionary) {
      cursor = skipWhite(this.bytes, dictionary.end);
      if (keywordAt(this.bytes, cursor, "stream")) {
        cursor += 6;
        if (this.bytes[cursor] === 13 && this.bytes[cursor + 1] === 10) cursor += 2;
        else if (this.bytes[cursor] === 10) cursor += 1;
        else throw new Error(`PDF stream ${number} must start after an EOL marker`);
        let length = directInteger(dictionary.text, "Length");
        if (!Number.isInteger(length)) {
          const lengthReference = reference(dictionary.text, "Length");
          if (!lengthReference) throw new Error(`PDF stream ${number} has no valid /Length`);
          const lengthObject = this.object(lengthReference);
          if (!Number.isInteger(lengthObject.value) || lengthObject.value < 0) throw new Error(`Indirect /Length for stream ${number} is invalid`);
          length = lengthObject.value;
        }
        object.data = this.bytes.slice(cursor, cursor + length);
        const afterStream = skipWhite(this.bytes, cursor + length);
        if (!keywordAt(this.bytes, afterStream, "endstream")) throw new Error(`PDF stream ${number} length does not end at endstream`);
      }
    } else {
      const scalar = readInteger(this.bytes, cursor);
      const terminator = skipWhite(this.bytes, scalar.end);
      if (!keywordAt(this.bytes, terminator, "endobj")) throw new Error(`Unsupported non-dictionary PDF object ${number}`);
      object.value = scalar.value;
    }
    this.cache.set(number, object);
    return object;
  }
  /**
   * Resolves any object -- type 1 (a normal indirect object, via the synchronous
   * object() above, which this shares its cache with) or type 2 (compressed inside
   * an Object Stream). Kept separate from object() rather than making the whole
   * object model async: only Object Streams need decoding (FlateDecode, Predictor,
   * and possibly AES -- see decodeObjectStream()), so only the call sites that can
   * actually hit a type 2 entry (pageContentObjects() below, and
   * pdf-document.js's font/resource lookups) need to await this instead.
   *
   * `security`/`decrypt` are only consulted for a type 2 entry, and only when the
   * PDF is encrypted: `decrypt` is the same decryptStreamBytes()-shaped function
   * pdf-document.js already uses for content streams, passed in rather than
   * imported here so this module stays unaware of what encryption even is (as it
   * already was before this) -- it just calls what it's given.
   */
  async resolveObject(referenceOrNumber, security, decrypt) {
    const number = typeof referenceOrNumber === "number" ? referenceOrNumber : referenceOrNumber.number;
    if (this.cache.has(number)) return this.cache.get(number);
    const entry = this.entries.get(number);
    if (!entry) throw new Error(`PDF object ${number} is missing from the xref table`);
    if (!entry.compressed) return this.object(number);
    const objectStreamEntries = await this.decodeObjectStream(entry.streamNumber, security, decrypt);
    if (entry.indexInStream < 0 || entry.indexInStream >= objectStreamEntries.length) {
      throw new Error(
        `Object stream index is out of range: object ${number} references index ${entry.indexInStream} in object stream ${entry.streamNumber}, which holds ${objectStreamEntries.length} object(s)`
      );
    }
    const found = objectStreamEntries[entry.indexInStream];
    if (found.objectNumber !== number) {
      throw new Error(
        `Object stream object number mismatch: xref expected object ${number}, object stream ${entry.streamNumber} index ${entry.indexInStream} contains object ${found.objectNumber}`
      );
    }
    const object = interpretCompressedObject(found, entry.streamNumber);
    this.cache.set(number, object);
    return object;
  }
  /**
   * Decodes Object Stream `streamNumber` into its component objects' byte ranges
   * (see parseObjectStream() in object-stream.js), decoding it at most once per
   * instance (objectStreamCache) regardless of how many of its compressed objects
   * are actually resolved.
   *
   * Decode order, per PDF spec 7.6 (encryption applies to the Object Stream itself
   * as a whole, before anything inside it is interpreted -- individual compressed
   * objects are never separately encrypted, so their generation number, always 0
   * per spec, plays no part in this): raw stream bytes -> AES decrypt (using the
   * Object Stream object's own number/generation, when `security` is set) ->
   * FlateDecode -> Predictor (both via the same decodeStreamBytes() every other
   * stream in this codebase uses) -> header/object parsing. This is exactly the
   * same pipeline decodeStream() in pdf-document.js applies to a content stream;
   * only the last step (interpreting the plaintext) differs.
   */
  async decodeObjectStream(streamNumber, security, decrypt) {
    if (this.objectStreamCache.has(streamNumber)) return this.objectStreamCache.get(streamNumber);
    const objectStream = this.object(streamNumber);
    if (!/\/Type\s*\/ObjStm\b/.test(objectStream.dictionary)) {
      throw new Error(`PDF object ${streamNumber} is not an object stream (expected /Type /ObjStm)`);
    }
    const objectCount = strictObjectStreamInteger(objectStream.dictionary, "N", streamNumber);
    const firstOffset = strictObjectStreamInteger(objectStream.dictionary, "First", streamNumber);
    const rawData = security ? await decrypt(security, { objectNumber: objectStream.number, generation: objectStream.generation, bytes: objectStream.data }) : objectStream.data;
    const decoded = await decodeStreamBytes(objectStream.dictionary, rawData, `object stream ${streamNumber}`);
    const entries = parseObjectStream(decoded, { objectCount, firstOffset });
    this.objectStreamCache.set(streamNumber, entries);
    return entries;
  }
  /**
   * `security`/`decrypt`: see resolveObject() above. Both are optional and only
   * matter when the Catalog, a Pages/Page node, or a Resources dictionary happens
   * to be a compressed (type 2) object -- Contents (always a stream) never is, per
   * spec, so that lookup stays on the synchronous object() unchanged.
   */
  async pageContentObjects(security, decrypt) {
    const catalog = await this.resolveObject(this.root, security, decrypt);
    const pagesReference = reference(catalog.dictionary, "Pages");
    if (!pagesReference) throw new Error("PDF catalog has no /Pages reference");
    const result = [];
    const ancestors = /* @__PURE__ */ new Set();
    const visited = /* @__PURE__ */ new Set();
    const visit = async (pageReference, inheritedResources = null) => {
      if (ancestors.has(pageReference.number)) throw new Error("Circular /Kids chain in the PDF page tree");
      if (visited.has(pageReference.number)) return;
      visited.add(pageReference.number);
      ancestors.add(pageReference.number);
      const page = await this.resolveObject(pageReference, security, decrypt);
      const resourcesReference = reference(page.dictionary, "Resources");
      const resources = resourcesReference ? await this.resolveObject(resourcesReference, security, decrypt) : /\/Resources\s*<</.test(page.dictionary) ? page : inheritedResources;
      if (/\/Type\s*\/Pages\b/.test(page.dictionary)) {
        for (const kid of parseReferenceArray(page.dictionary, "Kids")) await visit(kid, resources);
      } else if (/\/Type\s*\/Page\b/.test(page.dictionary)) {
        for (const content of parseReferenceArray(page.dictionary, "Contents")) result.push({
          object: this.object(content),
          resources: resources ?? { dictionary: page.dictionary }
        });
      }
      ancestors.delete(pageReference.number);
    };
    await visit(pagesReference);
    return result;
  }
};

// src/encryption.js
function cfmLabel(cfm) {
  switch (cfm) {
    case "None":
      return "\u6697\u53F7\u5316\u306A\u3057\uFF08Crypt Filter\u7D4C\u7531\u306E\u5E73\u6587\uFF09";
    case "V2":
      return "RC4\u7CFB";
    case "AESV2":
      return "AES-128\u7CFB";
    case "AESV3":
      return "AES-256\u7CFB";
    default:
      return null;
  }
}
function parseCryptFilters(dictionaryText) {
  const cfText = nestedDictionaryText(dictionaryText, "CF");
  if (!cfText) return [];
  return namedSubDictionaries(cfText).map(({ name, text }) => {
    const method = nameValue(text, "CFM");
    const lengthRaw = directInteger(text, "Length");
    const lengthBytes = Number.isInteger(lengthRaw) ? lengthRaw : null;
    return {
      name,
      method,
      methodLabel: method ? cfmLabel(method) : null,
      lengthBytes,
      lengthBits: lengthBytes === null ? null : lengthBytes * 8,
      authEvent: nameValue(text, "AuthEvent")
    };
  });
}
var PERMISSION_BITS = {
  print: 1 << 2,
  modify: 1 << 3,
  copy: 1 << 4,
  annotate: 1 << 5,
  fillForms: 1 << 8,
  extractForAccessibility: 1 << 9,
  assembleDocument: 1 << 10,
  printHighQuality: 1 << 11
};
function decodePermissions(p, revision) {
  if (typeof p !== "number" || !Number.isInteger(p)) return null;
  const has = (mask) => Boolean(p & mask);
  const permissions = {
    print: has(PERMISSION_BITS.print),
    modify: has(PERMISSION_BITS.modify),
    copy: has(PERMISSION_BITS.copy),
    annotate: has(PERMISSION_BITS.annotate),
    fillForms: null,
    extractForAccessibility: null,
    assembleDocument: null,
    printHighQuality: null
  };
  if (Number.isInteger(revision) && revision >= 3) {
    permissions.fillForms = has(PERMISSION_BITS.fillForms);
    permissions.extractForAccessibility = has(PERMISSION_BITS.extractForAccessibility);
    permissions.assembleDocument = has(PERMISSION_BITS.assembleDocument);
    permissions.printHighQuality = has(PERMISSION_BITS.printHighQuality);
  }
  return permissions;
}
function estimateMethod(version, cryptFilters, streamFilterName) {
  if (version === 1) return "Standard Security Handler / RC4-40";
  if (version === 2) return "Standard Security Handler / RC4\uFF08\u53EF\u5909\u9577\u9375\uFF09";
  if (version === 4 || version === 5) {
    const streamFilter = cryptFilters.find((filter) => filter.name === streamFilterName);
    if (streamFilter?.methodLabel) return `Standard Security Handler / ${streamFilter.methodLabel}`;
    return version === 5 ? "Standard Security Handler / AES-256\u7CFB" : null;
  }
  return null;
}
function analyzeEncryption(structure) {
  if (!structure.encryptReference) return { encrypted: false };
  const dictionaryText = structure.object(structure.encryptReference).dictionary;
  const filter = nameValue(dictionaryText, "Filter");
  const standardHandler = filter === "Standard";
  const versionRaw = topLevelInteger(dictionaryText, "V");
  const version = Number.isInteger(versionRaw) ? versionRaw : null;
  const revisionRaw = topLevelInteger(dictionaryText, "R");
  const revision = Number.isInteger(revisionRaw) ? revisionRaw : null;
  const lengthRaw = topLevelInteger(dictionaryText, "Length");
  const base = {
    encrypted: true,
    filter,
    subFilter: nameValue(dictionaryText, "SubFilter"),
    standardHandler,
    version,
    revision
  };
  if (!standardHandler) {
    return {
      ...base,
      lengthBits: Number.isInteger(lengthRaw) ? lengthRaw : null,
      lengthBitsSource: Number.isInteger(lengthRaw) ? "explicit" : "unspecified",
      permissionsRaw: null,
      permissions: null,
      streamFilter: null,
      stringFilter: null,
      encryptMetadata: null,
      cryptFilters: [],
      estimatedMethod: null
    };
  }
  let lengthBits;
  let lengthBitsSource;
  if (Number.isInteger(lengthRaw)) {
    lengthBits = lengthRaw;
    lengthBitsSource = "explicit";
  } else if (version === 1 || version === 2) {
    lengthBits = 40;
    lengthBitsSource = "default";
  } else {
    lengthBits = null;
    lengthBitsSource = "unspecified";
  }
  const permissionsRaw = signedInteger(dictionaryText, "P");
  const cryptFilters = version === 4 || version === 5 ? parseCryptFilters(dictionaryText) : [];
  const streamFilter = nameValue(dictionaryText, "StmF");
  const stringFilter = nameValue(dictionaryText, "StrF");
  return {
    ...base,
    lengthBits,
    lengthBitsSource,
    permissionsRaw,
    permissions: decodePermissions(permissionsRaw, revision),
    streamFilter,
    stringFilter,
    encryptFileFilter: nameValue(dictionaryText, "EFF"),
    encryptMetadata: booleanValue(dictionaryText, "EncryptMetadata", true),
    cryptFilters,
    estimatedMethod: estimateMethod(version, cryptFilters, streamFilter)
  };
}
function summarizeEncryption(diagnosis) {
  if (!diagnosis.encrypted) return null;
  if (!diagnosis.standardHandler) {
    return `Standard\u4EE5\u5916\u306ESecurity Handler: ${diagnosis.filter ?? "\u4E0D\u660E"}`;
  }
  const parts = ["Standard"];
  const methodLabel = diagnosis.cryptFilters.find((filter) => filter.name === diagnosis.streamFilter)?.methodLabel;
  if (diagnosis.version === 1 || diagnosis.version === 2) parts.push("RC4");
  else if (methodLabel) parts.push(methodLabel.replace("\u7CFB", ""));
  if (Number.isInteger(diagnosis.revision)) parts.push(`R${diagnosis.revision}`);
  return parts.join(" / ");
}

// src/security/md5.js
var SHIFTS = [
  7,
  12,
  17,
  22,
  7,
  12,
  17,
  22,
  7,
  12,
  17,
  22,
  7,
  12,
  17,
  22,
  5,
  9,
  14,
  20,
  5,
  9,
  14,
  20,
  5,
  9,
  14,
  20,
  5,
  9,
  14,
  20,
  4,
  11,
  16,
  23,
  4,
  11,
  16,
  23,
  4,
  11,
  16,
  23,
  4,
  11,
  16,
  23,
  6,
  10,
  15,
  21,
  6,
  10,
  15,
  21,
  6,
  10,
  15,
  21,
  6,
  10,
  15,
  21
];
var K = Int32Array.from([
  3614090360,
  3905402710,
  606105819,
  3250441966,
  4118548399,
  1200080426,
  2821735955,
  4249261313,
  1770035416,
  2336552879,
  4294925233,
  2304563134,
  1804603682,
  4254626195,
  2792965006,
  1236535329,
  4129170786,
  3225465664,
  643717713,
  3921069994,
  3593408605,
  38016083,
  3634488961,
  3889429448,
  568446438,
  3275163606,
  4107603335,
  1163531501,
  2850285829,
  4243563512,
  1735328473,
  2368359562,
  4294588738,
  2272392833,
  1839030562,
  4259657740,
  2763975236,
  1272893353,
  4139469664,
  3200236656,
  681279174,
  3936430074,
  3572445317,
  76029189,
  3654602809,
  3873151461,
  530742520,
  3299628645,
  4096336452,
  1126891415,
  2878612391,
  4237533241,
  1700485571,
  2399980690,
  4293915773,
  2240044497,
  1873313359,
  4264355552,
  2734768916,
  1309151649,
  4149444226,
  3174756917,
  718787259,
  3951481745
]);
function leftRotate(value, bits) {
  return value << bits | value >>> 32 - bits;
}
function md5(bytes) {
  const messageLength = bytes.length;
  const bitLength = messageLength * 8;
  let paddedLength = messageLength + 1;
  while (paddedLength % 64 !== 56) paddedLength += 1;
  paddedLength += 8;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[messageLength] = 128;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor(messageLength / 536870912), true);
  let a0 = 1732584193;
  let b0 = 4023233417;
  let c0 = 2562383102;
  let d0 = 271733878;
  const M = new Int32Array(16);
  for (let chunkStart = 0; chunkStart < paddedLength; chunkStart += 64) {
    for (let word = 0; word < 16; word += 1) M[word] = view.getUint32(chunkStart + word * 4, true);
    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;
    for (let i = 0; i < 64; i += 1) {
      let F;
      let g;
      if (i < 16) {
        F = B & C | ~B & D;
        g = i;
      } else if (i < 32) {
        F = D & B | ~D & C;
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = 7 * i % 16;
      }
      F = F + A + K[i] + M[g] | 0;
      A = D;
      D = C;
      C = B;
      B = B + leftRotate(F, SHIFTS[i]) | 0;
    }
    a0 = a0 + A | 0;
    b0 = b0 + B | 0;
    c0 = c0 + C | 0;
    d0 = d0 + D | 0;
  }
  const digest2 = new Uint8Array(16);
  const digestView = new DataView(digest2.buffer);
  digestView.setUint32(0, a0 >>> 0, true);
  digestView.setUint32(4, b0 >>> 0, true);
  digestView.setUint32(8, c0 >>> 0, true);
  digestView.setUint32(12, d0 >>> 0, true);
  return digest2;
}

// src/security/pdfdoc-encoding.js
var SPECIAL = /* @__PURE__ */ new Map([
  [728, 24],
  [711, 25],
  [710, 26],
  [729, 27],
  [733, 28],
  [731, 29],
  [730, 30],
  [732, 31],
  [8226, 128],
  [8224, 129],
  [8225, 130],
  [8230, 131],
  [8212, 132],
  [8211, 133],
  [402, 134],
  [8260, 135],
  [8249, 136],
  [8250, 137],
  [8722, 138],
  [8240, 139],
  [8222, 140],
  [8220, 141],
  [8221, 142],
  [8216, 143],
  [8217, 144],
  [8218, 145],
  [8482, 146],
  [64257, 147],
  [64258, 148],
  [321, 149],
  [338, 150],
  [352, 151],
  [376, 152],
  [381, 153],
  [305, 154],
  [322, 155],
  [339, 156],
  [353, 157],
  [382, 158],
  [8364, 160]
]);
function unrepresentable(codepoint) {
  const hex = codepoint.toString(16).toUpperCase().padStart(4, "0");
  const error = new Error(`Password contains a character that cannot be represented in PDFDocEncoding (U+${hex})`);
  error.recoverableWrongPassword = true;
  return error;
}
function encodePdfDocPassword(text) {
  const bytes = [];
  for (const char of text ?? "") {
    const codepoint = char.codePointAt(0);
    if (codepoint < 128) {
      if (codepoint >= 24 && codepoint <= 31 || codepoint === 127) throw unrepresentable(codepoint);
      bytes.push(codepoint);
      continue;
    }
    if (codepoint === 173) throw unrepresentable(codepoint);
    if (codepoint > 160 && codepoint < 256) {
      bytes.push(codepoint);
      continue;
    }
    const mapped = SPECIAL.get(codepoint);
    if (mapped === void 0) throw unrepresentable(codepoint);
    bytes.push(mapped);
  }
  return Uint8Array.from(bytes);
}

// src/security/rc4.js
function rc4(key, data) {
  if (key.length === 0) throw new Error("RC4 key must not be empty");
  const s = new Uint8Array(256);
  for (let i2 = 0; i2 < 256; i2 += 1) s[i2] = i2;
  let j = 0;
  for (let i2 = 0; i2 < 256; i2 += 1) {
    j = j + s[i2] + key[i2 % key.length] & 255;
    const temp = s[i2];
    s[i2] = s[j];
    s[j] = temp;
  }
  const output = new Uint8Array(data.length);
  let i = 0;
  j = 0;
  for (let n = 0; n < data.length; n += 1) {
    i = i + 1 & 255;
    j = j + s[i] & 255;
    const temp = s[i];
    s[i] = s[j];
    s[j] = temp;
    output[n] = data[n] ^ s[s[i] + s[j] & 255];
  }
  return output;
}

// src/security/standard-r4.js
var PASSWORD_PADDING = Uint8Array.of(
  40,
  191,
  78,
  94,
  78,
  117,
  138,
  65,
  100,
  0,
  78,
  86,
  255,
  250,
  1,
  8,
  46,
  46,
  0,
  182,
  208,
  104,
  62,
  128,
  47,
  12,
  169,
  254,
  100,
  83,
  105,
  122
);
function concatBytes(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
function padPassword(password) {
  const bytes = encodePdfDocPassword(password ?? "");
  const result = new Uint8Array(32);
  const take = Math.min(bytes.length, 32);
  result.set(bytes.subarray(0, take));
  result.set(PASSWORD_PADDING.subarray(0, 32 - take), take);
  return result;
}
function pBytesLittleEndian(p) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setInt32(0, p, true);
  return bytes;
}
function computeFileKey({ paddedPassword, o, p, idBytes, revision, keyLengthBytes, encryptMetadata }) {
  const parts = [paddedPassword, o.subarray(0, 32), pBytesLittleEndian(p), idBytes];
  if (revision >= 4 && encryptMetadata === false) parts.push(Uint8Array.of(255, 255, 255, 255));
  let hash = md5(concatBytes(parts));
  if (revision >= 3) {
    for (let iteration = 0; iteration < 50; iteration += 1) hash = md5(hash.subarray(0, keyLengthBytes));
  }
  return hash.slice(0, keyLengthBytes);
}
function computeUValue({ fileKey, idBytes }) {
  let encrypted = rc4(fileKey, md5(concatBytes([PASSWORD_PADDING, idBytes])));
  for (let iteration = 1; iteration <= 19; iteration += 1) {
    const iterationKey = fileKey.map((byte) => byte ^ iteration);
    encrypted = rc4(iterationKey, encrypted);
  }
  return encrypted;
}
function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a[index] ^ b[index];
  return diff === 0;
}
function authenticateUserPassword({ password, o, u, p, idBytes, revision, keyLengthBytes, encryptMetadata }) {
  const fileKey = computeFileKey({ paddedPassword: padPassword(password), o, p, idBytes, revision, keyLengthBytes, encryptMetadata });
  const success = constantTimeEqual(computeUValue({ fileKey, idBytes }), u.subarray(0, 16));
  return { success, fileKey: success ? fileKey : null };
}
function computeOwnerRc4Key({ paddedOwnerPassword, revision, keyLengthBytes }) {
  let hash = md5(paddedOwnerPassword);
  if (revision >= 3) {
    for (let iteration = 0; iteration < 50; iteration += 1) hash = md5(hash.subarray(0, keyLengthBytes));
  }
  return hash.slice(0, keyLengthBytes);
}
function recoverPaddedUserPassword({ o, ownerRc4Key, revision }) {
  let data = o.slice(0, 32);
  if (revision >= 3) {
    for (let iteration = 19; iteration >= 0; iteration -= 1) {
      const iterationKey = ownerRc4Key.map((byte) => byte ^ iteration);
      data = rc4(iterationKey, data);
    }
  } else {
    data = rc4(ownerRc4Key, data);
  }
  return data;
}
function authenticateOwnerPassword({ password, o, u, p, idBytes, revision, keyLengthBytes, encryptMetadata }) {
  const ownerRc4Key = computeOwnerRc4Key({ paddedOwnerPassword: padPassword(password), revision, keyLengthBytes });
  const recoveredUserPassword = recoverPaddedUserPassword({ o, ownerRc4Key, revision });
  const fileKey = computeFileKey({ paddedPassword: recoveredUserPassword, o, p, idBytes, revision, keyLengthBytes, encryptMetadata });
  const success = constantTimeEqual(computeUValue({ fileKey, idBytes }), u.subarray(0, 16));
  return { success, fileKey: success ? fileKey : null };
}
var AES_OBJECT_KEY_SALT = Uint8Array.of(115, 65, 108, 84);
function deriveObjectKey({ fileKey, objectNumber, generation, useAesSalt }) {
  const extra = new Uint8Array(5 + (useAesSalt ? AES_OBJECT_KEY_SALT.length : 0));
  extra[0] = objectNumber & 255;
  extra[1] = objectNumber >> 8 & 255;
  extra[2] = objectNumber >> 16 & 255;
  extra[3] = generation & 255;
  extra[4] = generation >> 8 & 255;
  if (useAesSalt) extra.set(AES_OBJECT_KEY_SALT, 5);
  const hash = md5(concatBytes([fileKey, extra]));
  return hash.slice(0, Math.min(fileKey.length + 5, 16));
}

// src/security/aes-primitives.js
var SBOX = Uint8Array.of(
  99,
  124,
  119,
  123,
  242,
  107,
  111,
  197,
  48,
  1,
  103,
  43,
  254,
  215,
  171,
  118,
  202,
  130,
  201,
  125,
  250,
  89,
  71,
  240,
  173,
  212,
  162,
  175,
  156,
  164,
  114,
  192,
  183,
  253,
  147,
  38,
  54,
  63,
  247,
  204,
  52,
  165,
  229,
  241,
  113,
  216,
  49,
  21,
  4,
  199,
  35,
  195,
  24,
  150,
  5,
  154,
  7,
  18,
  128,
  226,
  235,
  39,
  178,
  117,
  9,
  131,
  44,
  26,
  27,
  110,
  90,
  160,
  82,
  59,
  214,
  179,
  41,
  227,
  47,
  132,
  83,
  209,
  0,
  237,
  32,
  252,
  177,
  91,
  106,
  203,
  190,
  57,
  74,
  76,
  88,
  207,
  208,
  239,
  170,
  251,
  67,
  77,
  51,
  133,
  69,
  249,
  2,
  127,
  80,
  60,
  159,
  168,
  81,
  163,
  64,
  143,
  146,
  157,
  56,
  245,
  188,
  182,
  218,
  33,
  16,
  255,
  243,
  210,
  205,
  12,
  19,
  236,
  95,
  151,
  68,
  23,
  196,
  167,
  126,
  61,
  100,
  93,
  25,
  115,
  96,
  129,
  79,
  220,
  34,
  42,
  144,
  136,
  70,
  238,
  184,
  20,
  222,
  94,
  11,
  219,
  224,
  50,
  58,
  10,
  73,
  6,
  36,
  92,
  194,
  211,
  172,
  98,
  145,
  149,
  228,
  121,
  231,
  200,
  55,
  109,
  141,
  213,
  78,
  169,
  108,
  86,
  244,
  234,
  101,
  122,
  174,
  8,
  186,
  120,
  37,
  46,
  28,
  166,
  180,
  198,
  232,
  221,
  116,
  31,
  75,
  189,
  139,
  138,
  112,
  62,
  181,
  102,
  72,
  3,
  246,
  14,
  97,
  53,
  87,
  185,
  134,
  193,
  29,
  158,
  225,
  248,
  152,
  17,
  105,
  217,
  142,
  148,
  155,
  30,
  135,
  233,
  206,
  85,
  40,
  223,
  140,
  161,
  137,
  13,
  191,
  230,
  66,
  104,
  65,
  153,
  45,
  15,
  176,
  84,
  187,
  22
);
var INV_SBOX = new Uint8Array(256);
for (let index = 0; index < 256; index += 1) INV_SBOX[SBOX[index]] = index;
var RCON = Uint8Array.of(1, 2, 4, 8, 16, 32, 64, 128, 27, 54, 108, 216, 171, 77);
function gmul(a, b) {
  let product = 0;
  let x = a;
  let y = b;
  for (let bit = 0; bit < 8; bit += 1) {
    if (y & 1) product ^= x;
    const carry = x & 128;
    x = x << 1 & 255;
    if (carry) x ^= 27;
    y >>= 1;
  }
  return product;
}
function expandKey(key) {
  const wordCount = key.length / 4;
  if (!Number.isInteger(wordCount) || wordCount !== 4 && wordCount !== 8) {
    throw new Error(`Unsupported AES key length: ${key.length} bytes (only 16 or 32 are supported)`);
  }
  const roundCount = wordCount + 6;
  const words = [];
  for (let index = 0; index < wordCount; index += 1) {
    words.push(Uint8Array.of(key[4 * index], key[4 * index + 1], key[4 * index + 2], key[4 * index + 3]));
  }
  const totalWords = 4 * (roundCount + 1);
  for (let index = wordCount; index < totalWords; index += 1) {
    let temp = words[index - 1];
    if (index % wordCount === 0) {
      temp = Uint8Array.of(SBOX[temp[1]], SBOX[temp[2]], SBOX[temp[3]], SBOX[temp[0]]);
      temp = Uint8Array.of(temp[0] ^ RCON[index / wordCount - 1], temp[1], temp[2], temp[3]);
    } else if (wordCount > 6 && index % wordCount === 4) {
      temp = Uint8Array.of(SBOX[temp[0]], SBOX[temp[1]], SBOX[temp[2]], SBOX[temp[3]]);
    }
    const previous = words[index - wordCount];
    words.push(Uint8Array.of(previous[0] ^ temp[0], previous[1] ^ temp[1], previous[2] ^ temp[2], previous[3] ^ temp[3]));
  }
  return { words, roundCount };
}
function copyBytes(bytes) {
  return Uint8Array.from(bytes);
}
function addRoundKey(state, words, round) {
  for (let column = 0; column < 4; column += 1) {
    const word = words[4 * round + column];
    for (let row = 0; row < 4; row += 1) state[row + 4 * column] ^= word[row];
  }
}
function subBytes(state, table2) {
  for (let index = 0; index < 16; index += 1) state[index] = table2[state[index]];
}
function shiftRows(state) {
  const copy = copyBytes(state);
  for (let row = 1; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) state[row + 4 * column] = copy[row + 4 * ((column + row) % 4)];
  }
}
function invShiftRows(state) {
  const copy = copyBytes(state);
  for (let row = 1; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) state[row + 4 * column] = copy[row + 4 * ((column - row + 4) % 4)];
  }
}
function mixColumns(state) {
  for (let column = 0; column < 4; column += 1) {
    const base = 4 * column;
    const [s0, s1, s2, s3] = [state[base], state[base + 1], state[base + 2], state[base + 3]];
    state[base] = gmul(s0, 2) ^ gmul(s1, 3) ^ s2 ^ s3;
    state[base + 1] = s0 ^ gmul(s1, 2) ^ gmul(s2, 3) ^ s3;
    state[base + 2] = s0 ^ s1 ^ gmul(s2, 2) ^ gmul(s3, 3);
    state[base + 3] = gmul(s0, 3) ^ s1 ^ s2 ^ gmul(s3, 2);
  }
}
function invMixColumns(state) {
  for (let column = 0; column < 4; column += 1) {
    const base = 4 * column;
    const [s0, s1, s2, s3] = [state[base], state[base + 1], state[base + 2], state[base + 3]];
    state[base] = gmul(s0, 14) ^ gmul(s1, 11) ^ gmul(s2, 13) ^ gmul(s3, 9);
    state[base + 1] = gmul(s0, 9) ^ gmul(s1, 14) ^ gmul(s2, 11) ^ gmul(s3, 13);
    state[base + 2] = gmul(s0, 13) ^ gmul(s1, 9) ^ gmul(s2, 14) ^ gmul(s3, 11);
    state[base + 3] = gmul(s0, 11) ^ gmul(s1, 13) ^ gmul(s2, 9) ^ gmul(s3, 14);
  }
}
function encryptBlock({ words, roundCount }, input) {
  const state = copyBytes(input);
  addRoundKey(state, words, 0);
  for (let round = 1; round < roundCount; round += 1) {
    subBytes(state, SBOX);
    shiftRows(state);
    mixColumns(state);
    addRoundKey(state, words, round);
  }
  subBytes(state, SBOX);
  shiftRows(state);
  addRoundKey(state, words, roundCount);
  return state;
}
function decryptBlock({ words, roundCount }, input) {
  const state = copyBytes(input);
  addRoundKey(state, words, roundCount);
  for (let round = roundCount - 1; round >= 1; round -= 1) {
    invShiftRows(state);
    subBytes(state, INV_SBOX);
    addRoundKey(state, words, round);
    invMixColumns(state);
  }
  invShiftRows(state);
  subBytes(state, INV_SBOX);
  addRoundKey(state, words, 0);
  return state;
}
function requireBlockAligned(data, label) {
  if (data.length === 0 || data.length % 16 !== 0) throw new Error(`${label}: data length must be a non-zero multiple of 16 bytes`);
}
function aesEcbBlockDecrypt(key, block) {
  if (block.length !== 16) throw new Error("aesEcbBlockDecrypt: block must be exactly 16 bytes");
  return decryptBlock(expandKey(key), block);
}
function aesCbcNoPaddingEncrypt(key, iv, data) {
  requireBlockAligned(data, "aesCbcNoPaddingEncrypt");
  const context = expandKey(key);
  const output = new Uint8Array(data.length);
  let previous = iv;
  for (let offset = 0; offset < data.length; offset += 16) {
    const block = new Uint8Array(16);
    for (let index = 0; index < 16; index += 1) block[index] = data[offset + index] ^ previous[index];
    const encrypted = encryptBlock(context, block);
    output.set(encrypted, offset);
    previous = encrypted;
  }
  return output;
}
function aesCbcNoPaddingDecrypt(key, iv, data) {
  requireBlockAligned(data, "aesCbcNoPaddingDecrypt");
  const context = expandKey(key);
  const output = new Uint8Array(data.length);
  let previous = iv;
  for (let offset = 0; offset < data.length; offset += 16) {
    const block = data.subarray(offset, offset + 16);
    const decrypted = decryptBlock(context, block);
    for (let index = 0; index < 16; index += 1) output[offset + index] = decrypted[index] ^ previous[index];
    previous = block;
  }
  return output;
}

// src/security/standard-r6.js
var digest = sha2;
function concatBytes2(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
function constantTimeEqual2(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a[index] ^ b[index];
  return diff === 0;
}
var SASLPREP_MAP_TO_NOTHING = /* @__PURE__ */ new Set([
  173,
  847,
  6150,
  6155,
  6156,
  6157,
  8203,
  8204,
  8205,
  8288,
  65024,
  65025,
  65026,
  65027,
  65028,
  65029,
  65030,
  65031,
  65032,
  65033,
  65034,
  65035,
  65036,
  65037,
  65038,
  65039,
  65279
]);
var SASLPREP_SPACE_CODEPOINTS = /* @__PURE__ */ new Set([
  160,
  5760,
  8192,
  8193,
  8194,
  8195,
  8196,
  8197,
  8198,
  8199,
  8200,
  8201,
  8202,
  8239,
  8287,
  12288
]);
var PROHIBITED_UNICODE_CATEGORY = /[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Cn}\p{Zl}\p{Zp}]/u;
function isProhibitedSaslprepCodepoint(codePoint) {
  const character = String.fromCodePoint(codePoint);
  if (PROHIBITED_UNICODE_CATEGORY.test(character)) return true;
  if (codePoint === 65532 || codePoint === 65533) return true;
  if (codePoint >= 1424 && codePoint <= 2303) return true;
  if (codePoint >= 64285 && codePoint <= 65023) return true;
  if (codePoint >= 65136 && codePoint <= 65279) return true;
  return false;
}
function saslprep(password) {
  const withoutMapToNothing = [...password].filter((character) => !SASLPREP_MAP_TO_NOTHING.has(character.codePointAt(0)));
  const spaceMapped = withoutMapToNothing.map((character) => SASLPREP_SPACE_CODEPOINTS.has(character.codePointAt(0)) ? " " : character).join("");
  const normalized = spaceMapped.normalize("NFKC");
  for (const character of normalized) {
    if (isProhibitedSaslprepCodepoint(character.codePointAt(0))) {
      throw new Error(
        "Password contains characters outside this implementation's minimal SASLprep (RFC 4013) profile (only ASCII and general left-to-right-script UTF-8 passwords are supported)"
      );
    }
  }
  return normalized;
}
function preprocessR6Password(password) {
  const profiled = saslprep(password ?? "");
  const bytes = new TextEncoder().encode(profiled);
  return bytes.length > 127 ? bytes.subarray(0, 127) : bytes;
}
async function algorithm2B(passwordBytes, salt, userKey48 = null) {
  const initialInput = userKey48 ? [passwordBytes, salt, userKey48] : [passwordBytes, salt];
  let block = await digest("SHA-256", concatBytes2(initialInput));
  let round = 0;
  let lastE;
  while (true) {
    const unit = userKey48 ? concatBytes2([passwordBytes, block, userKey48]) : concatBytes2([passwordBytes, block]);
    const k1 = concatBytes2(new Array(64).fill(unit));
    const key = block.subarray(0, 16);
    const iv = block.subarray(16, 32);
    const e = aesCbcNoPaddingEncrypt(key, iv, k1);
    lastE = e;
    round += 1;
    let sum = 0;
    for (let index = 0; index < 16; index += 1) sum += e[index];
    const selector = sum % 3;
    if (selector === 0) block = await digest("SHA-256", e);
    else if (selector === 1) block = await digest("SHA-384", e);
    else block = await digest("SHA-512", e);
    if (round >= 64 && lastE[lastE.length - 1] <= round - 32) break;
  }
  return block.subarray(0, 32);
}
function requireLength(bytes, expected, name) {
  if (!bytes || bytes.length !== expected) {
    throw new Error(`Malformed /${name}: expected ${expected} bytes, got ${bytes ? bytes.length : "none"}`);
  }
}
var R6_VALIDATION_ENTRY_LENGTH = 48;
var R6_VALIDATION_ENTRY_ZERO_PADDING_LIMIT = 128;
function normalizeR6ValidationEntry(bytes, name) {
  if (!bytes || bytes.length < R6_VALIDATION_ENTRY_LENGTH) {
    throw new Error(`Malformed /${name}: expected 48 bytes, got ${bytes ? bytes.length : "none"}`);
  }
  if (bytes.length === R6_VALIDATION_ENTRY_LENGTH) {
    return { bytes, rawLength: 48, normalizedLength: 48, zeroPaddingCompatibilityApplied: false };
  }
  if (bytes.length > R6_VALIDATION_ENTRY_ZERO_PADDING_LIMIT) {
    throw new Error(
      `Malformed /${name}: expected 48 bytes, got ${bytes.length} (exceeds the ${R6_VALIDATION_ENTRY_ZERO_PADDING_LIMIT}-byte zero-padding compatibility limit)`
    );
  }
  const tail = bytes.subarray(R6_VALIDATION_ENTRY_LENGTH);
  if (!tail.every((byte) => byte === 0)) {
    throw new Error(
      `Malformed /${name}: expected 48 bytes, got ${bytes.length} with non-zero trailing bytes (not a recognized zero-padding compatibility form)`
    );
  }
  return {
    bytes: bytes.subarray(0, R6_VALIDATION_ENTRY_LENGTH),
    rawLength: bytes.length,
    normalizedLength: 48,
    zeroPaddingCompatibilityApplied: true
  };
}
async function authenticateUserPasswordR6({ password, u, ue }) {
  const normalizedU = normalizeR6ValidationEntry(u, "U").bytes;
  requireLength(ue, 32, "UE");
  const passwordBytes = preprocessR6Password(password);
  const validationSalt = normalizedU.subarray(32, 40);
  const keySalt = normalizedU.subarray(40, 48);
  const validationHash = await algorithm2B(passwordBytes, validationSalt, null);
  const success = constantTimeEqual2(validationHash, normalizedU.subarray(0, 32));
  if (!success) return { success: false, fileKey: null };
  const intermediateKey = await algorithm2B(passwordBytes, keySalt, null);
  const fileKey = aesCbcNoPaddingDecrypt(intermediateKey, new Uint8Array(16), ue);
  return { success: true, fileKey };
}
async function authenticateOwnerPasswordR6({ password, o, oe, u }) {
  const normalizedO = normalizeR6ValidationEntry(o, "O").bytes;
  const normalizedU = normalizeR6ValidationEntry(u, "U").bytes;
  requireLength(oe, 32, "OE");
  const passwordBytes = preprocessR6Password(password);
  const validationSalt = normalizedO.subarray(32, 40);
  const keySalt = normalizedO.subarray(40, 48);
  const validationHash = await algorithm2B(passwordBytes, validationSalt, normalizedU);
  const success = constantTimeEqual2(validationHash, normalizedO.subarray(0, 32));
  if (!success) return { success: false, fileKey: null };
  const intermediateKey = await algorithm2B(passwordBytes, keySalt, normalizedU);
  const fileKey = aesCbcNoPaddingDecrypt(intermediateKey, new Uint8Array(16), oe);
  return { success: true, fileKey };
}
var PERMS_MARKER = Uint8Array.of(97, 100, 98);
function validatePerms(fileKey, perms, p, encryptMetadata) {
  requireLength(perms, 16, "Perms");
  const decoded = aesEcbBlockDecrypt(fileKey, perms);
  const expectedP = new Uint8Array(4);
  new DataView(expectedP.buffer).setInt32(0, p, true);
  if (!constantTimeEqual2(decoded.subarray(0, 4), expectedP)) {
    throw new Error("Authentication succeeded but /Perms validation failed (permission bytes do not match /P)");
  }
  if (decoded[4] !== 255 || decoded[5] !== 255 || decoded[6] !== 255 || decoded[7] !== 255) {
    throw new Error("Authentication succeeded but /Perms validation failed (reserved bytes are not 0xFF)");
  }
  const expectedMetadataByte = encryptMetadata ? 84 : 70;
  if (decoded[8] !== expectedMetadataByte) {
    throw new Error("Authentication succeeded but /Perms validation failed (/EncryptMetadata mismatch)");
  }
  if (!constantTimeEqual2(decoded.subarray(9, 12), PERMS_MARKER)) {
    throw new Error('Authentication succeeded but /Perms validation failed (missing "adb" marker)');
  }
}

// src/security/aes.js
function removePkcs7Padding(plain) {
  const padding = plain[plain.length - 1];
  if (padding < 1 || padding > 16 || padding > plain.length) throw new Error("invalid PKCS#7 padding");
  for (let index = plain.length - padding; index < plain.length; index += 1) {
    if (plain[index] !== padding) throw new Error("invalid PKCS#7 padding");
  }
  return plain.subarray(0, plain.length - padding);
}
async function decryptAesCbc(key, ivAndCiphertext) {
  if (ivAndCiphertext.length < 16) throw new Error("AES-CBC data is shorter than one IV block (16 bytes)");
  const iv = ivAndCiphertext.subarray(0, 16);
  const ciphertext = ivAndCiphertext.subarray(16);
  if (ciphertext.length === 0 || ciphertext.length % 16 !== 0) {
    throw new Error("AES-CBC ciphertext length is not a multiple of the 16-byte block size");
  }
  const subtle = globalThis.crypto?.subtle;
  try {
    if (!subtle) return removePkcs7Padding(aesCbcNoPaddingDecrypt(key, iv, ciphertext));
    const cryptoKey = await subtle.importKey("raw", key, { name: "AES-CBC" }, false, ["decrypt"]);
    return new Uint8Array(await subtle.decrypt({ name: "AES-CBC", iv }, cryptoKey, ciphertext));
  } catch (error) {
    throw new Error(`AES-CBC decryption failed (invalid key or invalid PKCS#7 padding): ${error.message}`);
  }
}

// src/security/decrypt.js
function encryptionError(reason, diagnosis) {
  const error = new Error(`Encrypted PDFs are not supported (${reason})`);
  error.encryptionDiagnosis = diagnosis;
  return error;
}
function readFields(dictionaryText) {
  const filter = nameValue(dictionaryText, "Filter");
  const versionRaw = topLevelInteger(dictionaryText, "V");
  const revisionRaw = topLevelInteger(dictionaryText, "R");
  const o = stringValue(dictionaryText, "O");
  const u = stringValue(dictionaryText, "U");
  const oe = stringValue(dictionaryText, "OE");
  const ue = stringValue(dictionaryText, "UE");
  const perms = stringValue(dictionaryText, "Perms");
  const p = signedInteger(dictionaryText, "P");
  const encryptMetadata = booleanValue(dictionaryText, "EncryptMetadata", true);
  const streamFilterName = nameValue(dictionaryText, "StmF") ?? "Identity";
  const stringFilterName = nameValue(dictionaryText, "StrF") ?? "Identity";
  const cryptFilters = new Map(parseCryptFilters(dictionaryText).map((filterEntry) => [filterEntry.name, filterEntry]));
  return {
    filter,
    version: Number.isInteger(versionRaw) ? versionRaw : null,
    revision: Number.isInteger(revisionRaw) ? revisionRaw : null,
    o,
    u,
    oe,
    ue,
    perms,
    p,
    encryptMetadata,
    streamFilterName,
    stringFilterName,
    cryptFilters
  };
}
async function tryAuthenticate(authenticate, authArgs) {
  try {
    return await authenticate(authArgs);
  } catch (error) {
    if (error?.recoverableWrongPassword) return { success: false, fileKey: null };
    throw error;
  }
}
var SUPPORTED_CONFIGURATIONS = [
  { version: 4, revision: 4, cfm: "AESV2", keyLengthBytes: 16 },
  { version: 5, revision: 6, cfm: "AESV3", keyLengthBytes: 32 }
];
function matchConfiguration(version, revision) {
  return SUPPORTED_CONFIGURATIONS.find((entry) => entry.version === version && entry.revision === revision) ?? null;
}
function checkCryptFilterInScope(filterName, cryptFilters, configuration, diagnosis) {
  if (filterName === "Identity") return;
  const filter = cryptFilters.get(filterName);
  if (!filter || filter.method !== configuration.cfm) {
    throw encryptionError(`Unsupported crypt filter method: ${filter?.method ?? filterName ?? "\u4E0D\u660E"}`, diagnosis);
  }
  if (filter.lengthBytes !== null && filter.lengthBytes !== configuration.keyLengthBytes) {
    throw encryptionError(
      `Crypt filter /Length is inconsistent with /CFM /${configuration.cfm}: expected ${configuration.keyLengthBytes} bytes, got ${filter.lengthBytes}`,
      diagnosis
    );
  }
}
async function authenticateR4({ fields, structure, password, diagnosis }) {
  if (!fields.o || !fields.u) throw encryptionError("Encrypt dictionary is missing /O or /U", diagnosis);
  if (!structure.idBytes) throw encryptionError("PDF trailer is missing /ID (required for Standard Security Handler R4 authentication)", diagnosis);
  const activeFilter = fields.cryptFilters.get(fields.streamFilterName) ?? fields.cryptFilters.get(fields.stringFilterName);
  const keyLengthBytes = activeFilter?.lengthBytes ?? 16;
  const authArgs = {
    password: password ?? "",
    o: fields.o,
    u: fields.u,
    p: fields.p,
    idBytes: structure.idBytes,
    revision: fields.revision,
    keyLengthBytes,
    encryptMetadata: fields.encryptMetadata
  };
  const userAttempt = await tryAuthenticate(authenticateUserPassword, authArgs);
  if (userAttempt.success) return { authType: "user", fileKey: userAttempt.fileKey };
  const ownerAttempt = await tryAuthenticate(authenticateOwnerPassword, authArgs);
  if (ownerAttempt.success) return { authType: "owner", fileKey: ownerAttempt.fileKey };
  return null;
}
function requireR6FieldLength(bytes, expectedLength, name, diagnosis) {
  if (!bytes || bytes.length !== expectedLength) {
    throw encryptionError(`Malformed /${name}: expected ${expectedLength} bytes, got ${bytes ? bytes.length : "none"}`, diagnosis);
  }
  return bytes;
}
function normalizeR6Field(bytes, name, diagnosis) {
  try {
    return normalizeR6ValidationEntry(bytes, name);
  } catch (error) {
    throw encryptionError(error.message, diagnosis);
  }
}
function normalizationSummary(normalization) {
  const { rawLength, normalizedLength, zeroPaddingCompatibilityApplied } = normalization;
  return { rawLength, normalizedLength, zeroPaddingCompatibilityApplied };
}
async function authenticateR6({ fields, password, diagnosis }) {
  const uNormalization = normalizeR6Field(fields.u, "U", diagnosis);
  const oe = requireR6FieldLength(fields.oe, 32, "OE", diagnosis);
  const ue = requireR6FieldLength(fields.ue, 32, "UE", diagnosis);
  const perms = requireR6FieldLength(fields.perms, 16, "Perms", diagnosis);
  const userAttempt = await tryAuthenticate(authenticateUserPasswordR6, { password: password ?? "", u: fields.u, ue });
  let outcome = null;
  let oNormalization = null;
  if (userAttempt.success) {
    outcome = { authType: "user", fileKey: userAttempt.fileKey };
  } else {
    oNormalization = normalizeR6Field(fields.o, "O", diagnosis);
    const ownerAttempt = await tryAuthenticate(authenticateOwnerPasswordR6, { password: password ?? "", o: fields.o, oe, u: fields.u });
    if (ownerAttempt.success) outcome = { authType: "owner", fileKey: ownerAttempt.fileKey };
  }
  if (!outcome) return null;
  validatePerms(outcome.fileKey, perms, fields.p, fields.encryptMetadata);
  return {
    ...outcome,
    validationEntryNormalization: {
      U: normalizationSummary(uNormalization),
      O: oNormalization ? normalizationSummary(oNormalization) : null
    }
  };
}
async function authenticateEncryptedPdf(structure, password) {
  const diagnosis = analyzeEncryption(structure);
  const dictionaryText = structure.object(structure.encryptReference).dictionary;
  const fields = readFields(dictionaryText);
  if (fields.filter !== "Standard") {
    throw encryptionError(`Standard\u4EE5\u5916\u306ESecurity Handler: ${fields.filter ?? "\u4E0D\u660E"}`, diagnosis);
  }
  const configuration = matchConfiguration(fields.version, fields.revision);
  if (!configuration) {
    const supportedList = SUPPORTED_CONFIGURATIONS.map((entry) => `V${entry.version}/R${entry.revision}`).join(", ");
    throw encryptionError(
      `Unsupported encrypted PDF version/revision: V${fields.version ?? "\u4E0D\u660E"}/R${fields.revision ?? "\u4E0D\u660E"}\uFF08\u73FE\u5728\u306F ${supportedList} \u306E\u307F\u5BFE\u5FDC\uFF09`,
      diagnosis
    );
  }
  checkCryptFilterInScope(fields.streamFilterName, fields.cryptFilters, configuration, diagnosis);
  checkCryptFilterInScope(fields.stringFilterName, fields.cryptFilters, configuration, diagnosis);
  const outcome = configuration.revision === 4 ? await authenticateR4({ fields, structure, password, diagnosis }) : await authenticateR6({ fields, password, diagnosis });
  if (!outcome) return { authenticated: false, authType: null, fileKey: null, diagnosis };
  return {
    authenticated: true,
    authType: outcome.authType,
    fileKey: outcome.fileKey,
    // Password authentication and /P permission are deliberately independent checks:
    // owner authentication recovers the same file key a user login would, and does
    // NOT grant modification rights this engine does not already compute from /P
    // (revision 6 treats user and owner passwords equivalently for *access*, per
    // spec, but that is still not the same thing as this engine choosing to bypass
    // /P for an owner login -- it does not). See README for why owner
    // authentication never bypasses /P here.
    modifyAllowed: diagnosis.permissions?.modify ?? false,
    permissions: diagnosis.permissions,
    streamFilterName: fields.streamFilterName,
    stringFilterName: fields.stringFilterName,
    cryptFilters: fields.cryptFilters,
    diagnosis,
    revision: configuration.revision,
    encryptionMethod: configuration.cfm,
    // R6 only (undefined for R4): length-only metadata about the zero-padding
    // compatibility normalization applied to /O//U, if any -- see
    // normalizeR6ValidationEntry() in standard-r6.js. Never includes the bytes
    // themselves; safe to surface in a UI's debug details.
    validationEntryNormalization: outcome.validationEntryNormalization
  };
}
async function decryptWithFilter(security, filterName, { objectNumber, generation, bytes }) {
  if (!filterName || filterName === "Identity") return bytes;
  const filter = security.cryptFilters.get(filterName);
  if (!filter || filter.method !== security.encryptionMethod) {
    throw encryptionError(`Unsupported crypt filter method: ${filter?.method ?? filterName}`, security.diagnosis);
  }
  if (security.encryptionMethod === "AESV3") {
    return decryptAesCbc(security.fileKey, bytes);
  }
  const objectKey = deriveObjectKey({ fileKey: security.fileKey, objectNumber, generation, useAesSalt: true });
  return decryptAesCbc(objectKey, bytes);
}
function decryptStreamBytes(security, { objectNumber, generation, bytes }) {
  return decryptWithFilter(security, security.streamFilterName, { objectNumber, generation, bytes });
}

// src/pdf-document.js
var encoder2 = new TextEncoder();
var latin13 = new TextDecoder("latin1");
function encodeSingleByte(text) {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code > 255) throw new Error("String replacements are limited to single-byte characters; pass encoded Uint8Array data for composite fonts");
    bytes[index] = code;
  }
  return bytes;
}
var CONTEXT_RADIUS = 12;
function searchError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
function internalRuns(editor) {
  return editor.streams.flatMap((stream) => stream.runs.map((run, runIndex) => {
    const id = `${stream.object.number}:${runIndex}`;
    const mappings = stream.fontMaps.get(run.fontName);
    return {
      id,
      objectNumber: stream.object.number,
      continuityId: run.continuityId,
      joinBefore: run.joinBefore,
      fontName: run.fontName,
      // A run a fallback rewrite has replaced reads as what that rewrite drew, not as
      // what the original operand held -- otherwise search would keep reporting text the
      // document no longer shows, and a match into it would look fresh when it is not.
      text: editor.fallbackRunTexts.get(id) ?? decodeWithCMap(editor.pending.get(id) ?? run.value, mappings)
    };
  }));
}
function buildSegments(runs) {
  const segments = [];
  let current = null;
  for (const run of runs) {
    if (!current || current.objectNumber !== run.objectNumber || current.continuityId !== run.continuityId) {
      current = { objectNumber: run.objectNumber, continuityId: run.continuityId, points: [], entries: [] };
      segments.push(current);
    }
    const points = [...run.text];
    current.entries.push({ run, start: current.points.length, end: current.points.length + points.length });
    current.points.push(...points);
  }
  return segments;
}
function indexOfPoints(haystack, needle, from) {
  for (let start = from; start + needle.length <= haystack.length; start += 1) {
    let offset = 0;
    while (offset < needle.length && haystack[start + offset] === needle[offset]) offset += 1;
    if (offset === needle.length) return start;
  }
  return -1;
}
function charactersOutsideFont(editor, run, text) {
  const stream = editor.streams.find((candidate) => candidate.object.number === run.objectNumber);
  const mappings = stream.fontMaps.get(run.fontName);
  const known = mappings?.size ? new Set(mappings.values()) : null;
  return [...text].filter((character) => known ? !known.has(character) : character.codePointAt(0) > 255);
}
function encodeReplacement(editor, run, replacement) {
  if (typeof replacement !== "string") return Uint8Array.from(replacement);
  const stream = editor.streams.find((candidate) => candidate.object.number === run.objectNumber);
  const mappings = stream.fontMaps.get(run.fontName);
  return mappings ? encodeWithCMap(replacement, mappings) : encodeSingleByte(replacement);
}
var REPLACEMENT_MODE = {
  singleRun: "single-run",
  sameLength: "same-length",
  delete: "delete",
  variableLength: "variable-length-safe",
  // Written through a caller-supplied fallback font (see setFallbackFont), because the
  // document's own font has no code for some of the replacement's characters.
  fallbackFont: "fallback-font",
  fallbackFontPartial: "fallback-font-partial",
  fallbackFontMultiRun: "fallback-font-multi-run"
};
var POSITION_SAFE_AFTER = /* @__PURE__ */ new Set(["end-of-text-object", "repositioned"]);
function refusal(code, reason, unsafeReason) {
  return unsafeReason ? { allowed: false, code, reason, unsafeReason } : { allowed: false, code, reason };
}
function variableLengthObstacle(span, current) {
  for (let index = 1; index < span.length; index += 1) {
    const join = current.get(span[index].runId)?.joinBefore;
    if (!join) return "unsupported-topology";
    if (join.kind === "state-change") return "text-state-boundary";
    if (join.adjustment !== 0) return "non-zero-tj-adjustment";
  }
  return null;
}
function scannedRuns(editor, span) {
  return span.map((entry) => {
    const [objectNumber, runIndex] = entry.runId.split(":").map(Number);
    const stream = editor.streams.find((candidate) => candidate.object.number === objectNumber);
    return { stream, run: stream?.runs[runIndex], entry };
  });
}
async function registerFallbackResource(editor, embedded, resources) {
  if (resources?.number === void 0) {
    return refusal("FALLBACK_LAYOUT_UNSUPPORTED", "This page's /Resources are not an addressable object, so the fallback font cannot be added to them");
  }
  const existing = embedded.resources.get(resources.number);
  if (existing) return { name: existing };
  const indirect = reference(resources.dictionary, "Font");
  let holder = resources;
  if (indirect) {
    try {
      holder = await editor.document.resolveObject(indirect, editor.security, decryptStreamBytes);
    } catch (error) {
      return refusal("FALLBACK_LAYOUT_UNSUPPORTED", `This page's /Font resources could not be read in order to add the fallback font to them: ${error.message}`);
    }
  }
  const inline = indirect ? null : resources.dictionary.match(/\/Font\s*<<([\s\S]*?)>>/);
  let name;
  let dictionary;
  if (indirect) {
    name = freeResourceName(holder.dictionary);
    dictionary = holder.dictionary.replace(/>>\s*$/, `/${name} ${embedded.numbers.type0} 0 R >>`);
  } else if (inline) {
    name = freeResourceName(inline[1]);
    dictionary = resources.dictionary.replace(inline[0], `/Font << ${inline[1].trim()} /${name} ${embedded.numbers.type0} 0 R >>`);
  } else {
    name = "ILPFallback";
    dictionary = resources.dictionary.replace(/>>\s*$/, `/Font << /${name} ${embedded.numbers.type0} 0 R >> >>`);
  }
  embedded.resources.set(resources.number, name);
  return { name, object: { number: holder.number, generation: holder.generation, dictionary } };
}
async function adoptExistingFallbackFont(editor, fallback) {
  const marker = new RegExp(`/${FALLBACK_FONT_MARKER}\\s*<\\s*([0-9a-fA-F]+)\\s*>`);
  for (const stream of editor.streams) {
    if (stream.resources?.number === void 0) continue;
    let holder = stream.resources;
    const indirect = reference(stream.resources.dictionary, "Font");
    if (indirect) {
      try {
        holder = await editor.document.resolveObject(indirect, editor.security, decryptStreamBytes);
      } catch {
        continue;
      }
    }
    const fonts = indirect ? holder.dictionary : holder.dictionary.match(/\/Font\s*<<([\s\S]*?)>>/)?.[1] ?? "";
    for (const entry of fonts.matchAll(/\/([^\s/<>{}[\]()]+)\s+(\d+)\s+(\d+)\s+R/g)) {
      let type0;
      try {
        type0 = await editor.document.resolveObject({ number: Number(entry[2]), generation: Number(entry[3]) }, editor.security, decryptStreamBytes);
      } catch {
        continue;
      }
      const marked = type0.dictionary.match(marker);
      if (!marked || marked[1].toLowerCase() !== fallback.digest) continue;
      if (!new RegExp(`/BaseFont\\s*/${fallback.postScriptName}\\b`).test(type0.dictionary)) continue;
      const [cidFontReference] = parseReferenceArray(type0.dictionary, "DescendantFonts");
      const toUnicodeReference = reference(type0.dictionary, "ToUnicode");
      if (!cidFontReference || !toUnicodeReference) continue;
      const cidFont = await editor.document.resolveObject(cidFontReference, editor.security, decryptStreamBytes);
      const descriptorReference = reference(cidFont.dictionary, "FontDescriptor");
      if (!descriptorReference) continue;
      const cmapObject = editor.document.object(toUnicodeReference);
      const glyphs = glyphsFromToUnicode(fallback, parseToUnicodeCMap(await decodeStream(cmapObject, "ToUnicode stream", editor.security)));
      const resources = /* @__PURE__ */ new Map();
      for (const other of editor.streams) {
        if (other.resources?.number === void 0) continue;
        const otherIndirect = reference(other.resources.dictionary, "Font");
        let otherHolder = other.resources;
        if (otherIndirect) {
          try {
            otherHolder = await editor.document.resolveObject(otherIndirect, editor.security, decryptStreamBytes);
          } catch {
            continue;
          }
        }
        const text = otherIndirect ? otherHolder.dictionary : otherHolder.dictionary.match(/\/Font\s*<<([\s\S]*?)>>/)?.[1] ?? "";
        const named = text.match(new RegExp(`/([^\\s/<>{}\\[\\]()]+)\\s+${type0.number}\\s+\\d+\\s+R`));
        if (named) resources.set(other.resources.number, named[1]);
      }
      return {
        numbers: {
          type0: type0.number,
          cidFont: cidFont.number,
          descriptor: descriptorReference.number,
          fontFile: null,
          toUnicode: toUnicodeReference.number
        },
        resources,
        glyphs,
        programAlreadyEmbedded: true
      };
    }
  }
  return null;
}
async function planFallbackReplacement(editor, match, replacement) {
  const fallback = editor.fallbackFont;
  const pieces = scannedRuns(editor, match.span);
  if (pieces.some(({ run }) => !run)) return refusal("MATCH_STALE", "This match no longer describes the document");
  const operator = pieces.find(({ run }) => run.operator !== "Tj");
  if (operator) {
    return refusal("FALLBACK_OPERATOR_UNSUPPORTED", `The fallback font is written with Tj; this match is drawn by ${operator.run.operator}`);
  }
  const sideways = pieces.find(({ stream, run }) => (stream.fontModes?.get(run.fontName) ?? "unknown") !== "horizontal");
  if (sideways) {
    const mode2 = sideways.stream.fontModes?.get(sideways.run.fontName) ?? "unknown";
    return refusal(
      "FALLBACK_WRITING_MODE_UNSUPPORTED",
      mode2 === "vertical" ? "This text is drawn with a vertical writing font, and the fallback font is embedded for horizontal writing, so it cannot stand in for it" : "This text's font does not say whether it writes horizontally or vertically, and the fallback font is embedded for horizontal writing, so it cannot safely stand in for it"
    );
  }
  const sizes = new Set(pieces.map(({ run }) => run.fontSize));
  if (sizes.size > 1 || sizes.has(null) || sizes.has(void 0)) {
    return refusal("FALLBACK_LAYOUT_UNSUPPORTED", "This match has no single /Tf font size to restore after the fallback font");
  }
  if (pieces.some(({ run }) => !run.fontName)) {
    return refusal("FALLBACK_LAYOUT_UNSUPPORTED", "This match has no /Tf font to restore after the fallback font");
  }
  if (match.span.length > 1) {
    const current = new Map(internalRuns(editor).map((run) => [run.id, run]));
    const obstacle = variableLengthObstacle(match.span, current);
    if (obstacle) {
      return refusal("FALLBACK_MULTI_RUN_UNSUPPORTED", `This match is drawn as ${match.span.length} text runs that are not simply adjacent (${obstacle}), so it cannot be redrawn in another font as one piece`, obstacle);
    }
  }
  if ([...replacement].includes(" ") && pieces.some(({ run }) => run.wordSpacing !== 0)) {
    return refusal(
      "FALLBACK_WORD_SPACING_UNSUPPORTED",
      "This text is drawn with word spacing (Tw) in force, which does not reach text written through the fallback font, so a replacement containing a space would be spaced differently from the rest of the document. Replace without a space, or edit text drawn without word spacing."
    );
  }
  const last = pieces.at(-1).run;
  if (!POSITION_SAFE_AFTER.has(last.followedBy)) {
    return refusal(
      "FALLBACK_FOLLOWING_TEXT_POSITION_UNSAFE",
      `Text is drawn from where this match ends (${last.followedBy}), and the fallback font's characters are not the widths the document's own font used, so that text would move. Only a match followed by ET or an explicit Td/TD/Tm/T* is redrawn in another font.`
    );
  }
  const { glyphs, missing } = glyphsFor(fallback, replacement);
  if (missing) {
    return { ...refusal("FALLBACK_FONT_MISSING_GLYPH", `The fallback font has no glyph for ${missing.map((character) => JSON.stringify(character)).join(", ")}`), characters: missing };
  }
  const base = editor.fallbackEmbedding ?? await adoptExistingFallbackFont(editor, fallback);
  const start = Math.max(editor.document.size, ...[...editor.pendingObjects.keys()].map((number) => number + 1));
  const embedded = {
    numbers: base?.numbers ?? { type0: start, cidFont: start + 1, descriptor: start + 2, fontFile: start + 3, toUnicode: start + 4 },
    resources: new Map(base?.resources),
    glyphs: new Map(base?.glyphs),
    // True once the font program is in the file, whether this session put it there or an
    // earlier one did: from then on only the widths and the ToUnicode CMap are rewritten.
    programAlreadyEmbedded: Boolean(base)
  };
  const objects = /* @__PURE__ */ new Map();
  const resourceNames = /* @__PURE__ */ new Map();
  for (const { stream } of pieces) {
    const registered = await registerFallbackResource(editor, embedded, stream.resources);
    if (registered.allowed === false) return registered;
    resourceNames.set(stream.object.number, registered.name);
    if (registered.object) objects.set(registered.object.number, registered.object);
  }
  for (const glyph of glyphs) embedded.glyphs.set(glyph.glyphId, glyph);
  const edits = [];
  try {
    pieces.forEach(({ stream, run, entry }, index) => {
      const points = [...entry.runText];
      const prefix = points.slice(0, entry.charStart).join("");
      const suffix = points.slice(entry.charEnd).join("");
      const size = run.fontSize;
      const name = resourceNames.get(stream.object.number);
      const operand = (bytes) => latin13.decode(run.syntax === "hex" ? encodeHex(bytes) : encodeLiteral(bytes));
      if (index === 0) {
        const drawn = [];
        if (prefix) drawn.push(`${operand(encodeReplacement(editor, entry, prefix))} Tj`);
        drawn.push(`/${name} ${size} Tf ${latin13.decode(encodeHex(identityEncode(glyphs)))} Tj /${run.fontName} ${size} Tf`);
        if (pieces.length === 1 && suffix) drawn.push(`${operand(encodeReplacement(editor, entry, suffix))} Tj`);
        edits.push({
          objectNumber: stream.object.number,
          start: run.start,
          end: run.operatorEnd,
          bytes: encoder2.encode(drawn.join(" ")),
          runId: entry.runId,
          runText: prefix + replacement + (pieces.length === 1 ? suffix : "")
        });
      } else if (index === pieces.length - 1) {
        edits.push({ objectNumber: stream.object.number, start: run.start, end: run.end, bytes: encodeReplacement(editor, entry, suffix), operandOnly: true, runId: entry.runId, runText: suffix });
      } else {
        edits.push({ objectNumber: stream.object.number, start: run.start, end: run.end, bytes: new Uint8Array(), operandOnly: true, runId: entry.runId, runText: "" });
      }
    });
  } catch (error) {
    return { ...refusal("FONT_ENCODING_UNSUPPORTED", error.message), cause: error };
  }
  const mode = match.span.length > 1 ? REPLACEMENT_MODE.fallbackFontMultiRun : pieces[0].entry.charStart === 0 && pieces[0].entry.charEnd === [...pieces[0].entry.runText].length ? REPLACEMENT_MODE.fallbackFont : REPLACEMENT_MODE.fallbackFontPartial;
  for (const [number, object] of await buildFallbackFontObjects(fallback, embedded.numbers, embedded.glyphs, { programAlreadyEmbedded: embedded.programAlreadyEmbedded })) {
    objects.set(number, object);
  }
  return { allowed: true, mode, updates: [], fallback: { embedding: embedded, objects, edits } };
}
async function planTextMatchReplacement(editor, matchId, replacement) {
  if (editor.security && editor.security.modifyAllowed === false) {
    return refusal("MODIFICATION_NOT_PERMITTED", "Document modification is not permitted: this PDF's /P permissions disallow content changes (modify permission denied)");
  }
  if (typeof replacement !== "string") {
    return refusal("REPLACEMENT_NOT_A_STRING", "replaceTextMatch() takes the replacement as a string; use replaceText() to write raw font-encoded bytes to a single run");
  }
  const match = editor.matches.get(matchId);
  if (!match) {
    return refusal("UNKNOWN_MATCH", `Unknown search match: ${matchId} (match ids come from this editor's most recent searchText() call and are superseded by the next one)`);
  }
  const current = new Map(internalRuns(editor).map((run) => [run.id, run]));
  for (const entry of match.span) {
    if (current.get(entry.runId)?.text !== entry.runText) {
      return refusal("MATCH_STALE", `This match is stale: the text it was found in has changed since searchText() returned it (run ${entry.runId}). Search again and replace the new match.`);
    }
  }
  const rewritten = match.span.find((entry) => editor.fallbackRunTexts.has(entry.runId));
  if (rewritten) {
    return refusal(
      "FALLBACK_EDIT_REQUIRES_SAVE",
      `Text run ${rewritten.runId} has already been rewritten with the fallback font, which restructured the operators it was drawn by. Save this document and reopen it to edit that text again.`
    );
  }
  const replacementPoints = [...replacement];
  let mode;
  let chunks;
  if (match.span.length === 1) {
    mode = REPLACEMENT_MODE.singleRun;
    chunks = [replacementPoints];
  } else {
    const fonts = new Set(match.span.map((entry) => entry.fontName));
    if (fonts.size > 1) {
      return refusal("MULTI_RUN_FONT_CHANGE_UNSUPPORTED", `This match spans ${fonts.size} fonts; replacing it would have to encode its characters through more than one font, which is not supported`);
    }
    const matchLength = [...match.text].length;
    if (!replacementPoints.length) {
      mode = REPLACEMENT_MODE.delete;
      chunks = match.span.map(() => []);
    } else if (replacementPoints.length === matchLength) {
      mode = REPLACEMENT_MODE.sameLength;
      let cursor = 0;
      chunks = match.span.map((entry) => {
        const contributed = entry.charEnd - entry.charStart;
        const chunk = replacementPoints.slice(cursor, cursor + contributed);
        cursor += contributed;
        return chunk;
      });
    } else {
      const obstacle = variableLengthObstacle(match.span, current);
      if (obstacle) {
        return refusal(
          "MULTI_RUN_LENGTH_CHANGE_UNSUPPORTED",
          `This match is drawn as ${match.span.length} separate text runs, so a replacement of ${replacementPoints.length} characters cannot be written over ${matchLength} without moving text relative to the PDF's own spacing (${obstacle}). Use an equal-length replacement, or an empty one to delete.`,
          obstacle
        );
      }
      mode = REPLACEMENT_MODE.variableLength;
      chunks = match.span.map((_, index) => index === 0 ? replacementPoints : []);
    }
  }
  const updates = [];
  try {
    match.span.forEach((entry, index) => {
      const points = [...entry.runText];
      const text = points.slice(0, entry.charStart).join("") + chunks[index].join("") + points.slice(entry.charEnd).join("");
      if (text === entry.runText) return;
      updates.push({ id: entry.runId, bytes: encodeReplacement(editor, entry, text) });
    });
  } catch (error) {
    const characters = charactersOutsideFont(editor, match.span[0], replacement);
    if (!editor.fallbackFont) {
      return { ...refusal("FONT_ENCODING_UNSUPPORTED", error.message), characters, cause: error };
    }
    const viaFallback = await planFallbackReplacement(editor, match, replacement);
    if (viaFallback.allowed) return viaFallback;
    return { ...viaFallback, characters: viaFallback.characters ?? characters };
  }
  return { allowed: true, mode, updates };
}
function commitPlan(editor, plan) {
  if (!plan.fallback) {
    for (const { id, bytes } of plan.updates) editor.pending.set(id, bytes);
    return;
  }
  const edits = /* @__PURE__ */ new Map();
  for (const [objectNumber, existing] of editor.fallbackEdits) edits.set(objectNumber, [...existing]);
  for (const edit of plan.fallback.edits) {
    edits.set(edit.objectNumber, [...edits.get(edit.objectNumber) ?? [], edit]);
  }
  const rebuilt = /* @__PURE__ */ new Map();
  for (const objectNumber of new Set(plan.fallback.edits.map((edit) => edit.objectNumber))) {
    rebuilt.set(objectNumber, rebuildContentStream(editor, objectNumber, edits.get(objectNumber)));
  }
  for (const { id, bytes } of plan.updates) editor.pending.set(id, bytes);
  editor.fallbackEmbedding = plan.fallback.embedding;
  for (const [number, object] of plan.fallback.objects) editor.pendingObjects.set(number, object);
  editor.fallbackEdits = edits;
  for (const [objectNumber, bytes] of rebuilt) editor.pendingStreams.set(objectNumber, bytes);
  for (const edit of plan.fallback.edits) {
    if (edit.runId !== void 0) editor.fallbackRunTexts.set(edit.runId, edit.runText);
  }
}
function rebuildContentStream(editor, objectNumber, fallbackEdits) {
  const stream = editor.streams.find((candidate) => candidate.object.number === objectNumber);
  const rewritten = new Set(fallbackEdits.map((edit) => edit.runId).filter((runId) => runId !== void 0));
  const runEdits = stream.runs.flatMap((run, index) => {
    const id = `${objectNumber}:${index}`;
    const bytes = editor.pending.get(id);
    if (!bytes || rewritten.has(id)) return [];
    return [{ start: run.start, end: run.end, bytes: run.syntax === "hex" ? encodeHex(bytes) : encodeLiteral(bytes) }];
  });
  const ordered = [...fallbackEdits, ...runEdits].map((edit) => ({ ...edit, bytes: edit.operandOnly ? stream.runs.find((run) => run.start === edit.start)?.syntax === "hex" ? encodeHex(edit.bytes) : encodeLiteral(edit.bytes) : edit.bytes })).sort((a, b) => a.start - b.start);
  const chunks = [];
  let cursor = 0;
  for (const edit of ordered) {
    if (edit.start < cursor) throw new Error("Two edits to one content stream overlap");
    chunks.push(stream.decoded.subarray(cursor, edit.start), edit.bytes);
    cursor = edit.end;
  }
  chunks.push(stream.decoded.subarray(cursor));
  return concat(chunks);
}
function planError(plan) {
  const error = new Error(plan.reason);
  error.code = plan.code;
  if (plan.unsafeReason) error.unsafeReason = plan.unsafeReason;
  if (plan.characters?.length) error.characters = plan.characters;
  if (plan.cause) error.cause = plan.cause;
  return error;
}
function concat(chunks) {
  const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
async function decodeStream(object, kind, security) {
  const data = security ? await decryptStreamBytes(security, { objectNumber: object.number, generation: object.generation, bytes: object.data }) : object.data;
  return decodeStreamBytes(object.dictionary, data, `${kind} object ${object.number}`);
}
function replacementDictionary(dictionary, length) {
  const withoutDecodeParms = dictionary.replace(/\/DecodeParms\s*\[\s*<<[\s\S]*?>>\s*\]/, "").replace(/\/DecodeParms\s*<<[\s\S]*?>>/, "");
  if (/\/Length\s+\d+\s+\d+\s+R/.test(withoutDecodeParms)) return withoutDecodeParms.replace(/\/Length\s+\d+\s+\d+\s+R/, `/Length ${length}`);
  if (/\/Length\s+\d+/.test(withoutDecodeParms)) return withoutDecodeParms.replace(/\/Length\s+\d+/, `/Length ${length}`);
  return withoutDecodeParms.replace(/>>\s*$/, `/Length ${length} >>`);
}
async function fontReferences(resources, structure, security) {
  const indirect = reference(resources.dictionary, "Font");
  const fontDictionary = indirect ? (await structure.resolveObject(indirect, security, decryptStreamBytes)).dictionary : resources.dictionary.match(/\/Font\s*<<(.*?)>>/s)?.[1] ?? "";
  return new Map([...fontDictionary.matchAll(/\/([^\s/<>{}\[\]()]+)\s+(\d+)\s+(\d+)\s+R/g)].map((match) => [
    match[1],
    { number: Number(match[2]), generation: Number(match[3]) }
  ]));
}
function writingModeOf(fontDictionary, structure) {
  if (!/\/Subtype\s*\/Type0\b/.test(fontDictionary)) return "horizontal";
  const named = fontDictionary.match(/\/Encoding\s*\/([^\s/<>[\]()]+)/);
  if (named) {
    if (/-V$/.test(named[1])) return "vertical";
    return /-H$/.test(named[1]) ? "horizontal" : "unknown";
  }
  const indirect = reference(fontDictionary, "Encoding");
  if (!indirect) return "unknown";
  try {
    const wmode = structure.object(indirect).dictionary.match(/\/WMode\s+(\d+)/);
    if (!wmode) return "unknown";
    return wmode[1] === "1" ? "vertical" : "horizontal";
  } catch {
    return "unknown";
  }
}
async function loadFontMaps(resources, structure, security) {
  const result = /* @__PURE__ */ new Map();
  const modes = /* @__PURE__ */ new Map();
  for (const [name, fontReference] of await fontReferences(resources, structure, security)) {
    const font = await structure.resolveObject(fontReference, security, decryptStreamBytes);
    modes.set(name, writingModeOf(font.dictionary, structure));
    const toUnicode = reference(font.dictionary, "ToUnicode");
    if (!toUnicode) continue;
    const cmapObject = structure.object(toUnicode);
    result.set(name, parseToUnicodeCMap(await decodeStream(cmapObject, "ToUnicode stream", security)));
  }
  return { maps: result, modes };
}
var PdfTextEditor = class {
  constructor(input) {
    this.bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (latin13.decode(this.bytes.subarray(0, 5)) !== "%PDF-") throw new Error("Input is not a PDF document");
    this.document = new PdfStructure(this.bytes);
    this.streams = null;
    this.pending = /* @__PURE__ */ new Map();
    this.pendingObjects = /* @__PURE__ */ new Map();
    this.pendingStreams = /* @__PURE__ */ new Map();
    this.fallbackFont = null;
    this.fallbackEmbedding = null;
    this.fallbackEdits = /* @__PURE__ */ new Map();
    this.fallbackRunTexts = /* @__PURE__ */ new Map();
    this.matches = /* @__PURE__ */ new Map();
    this.matchNamespace = Math.random().toString(36).slice(2, 10);
    this.matchCounter = 0;
    this.security = null;
  }
  /**
   * `password` is only consulted the first time this resolves (later calls, e.g.
   * from replaceText()/save(), reuse whatever was already authenticated). Defaults
   * to the empty string, so a caller can always try "no password" first -- most
   * PDFs that a normal reader opens without prompting use an empty user password.
   * A failed attempt leaves `this.streams` unset, so calling this again with a real
   * password retries cleanly.
   */
  async listTextRuns(password) {
    if (!this.streams) {
      await this.document.ensureXref();
      if (this.document.encryptReference) {
        const security = await authenticateEncryptedPdf(this.document, password ?? "");
        if (!security.authenticated) {
          const summary = summarizeEncryption(security.diagnosis);
          const error = new Error(`Password required to open this encrypted PDF${summary ? ` (${summary})` : ""}`);
          error.encryptionDiagnosis = security.diagnosis;
          error.passwordRequired = true;
          throw error;
        }
        this.security = security;
      }
      this.streams = [];
      const seen = /* @__PURE__ */ new Set();
      for (const { object, resources } of await this.document.pageContentObjects(this.security, decryptStreamBytes)) {
        if (seen.has(object.number)) continue;
        seen.add(object.number);
        const decoded = await decodeStream(object, "content stream", this.security);
        const runs = scanTextRuns(decoded, `content stream object ${object.number}`);
        if (runs.length) {
          const fonts = await loadFontMaps(resources, this.document, this.security);
          this.streams.push({ object, decoded, runs, resources, fontMaps: fonts.maps, fontModes: fonts.modes });
        }
      }
    }
    return this.streams.flatMap((stream) => stream.runs.map((run, runIndex) => ({
      id: `${stream.object.number}:${runIndex}`,
      objectNumber: stream.object.number,
      textObjectId: run.textObjectId,
      text: decodeWithCMap(run.value, stream.fontMaps.get(run.fontName)),
      fontName: run.fontName,
      bytes: run.value.slice()
    })));
  }
  async replaceText(id, replacement) {
    const runs = await this.listTextRuns();
    if (this.security && this.security.modifyAllowed === false) {
      throw new Error("Document modification is not permitted: this PDF's /P permissions disallow content changes (modify permission denied)");
    }
    const run = runs.find((candidate) => candidate.id === id);
    if (!run) throw new Error(`Unknown text run: ${id}`);
    this.pending.set(id, encodeReplacement(this, run, replacement));
    return this;
  }
  /**
   * Finds `query` in the text a reader of this PDF actually sees, across the run
   * boundaries the PDF happens to have split that text on.
   *
   * This is the high-level, caller-facing search. A word is very often drawn as several
   * text-showing operands -- "令和6年度" as `[(令) 120 (和) -20 (6) 0 (年) 0 (度)] TJ`
   * is five of them, hence five runs -- so searching the runs of listTextRuns() one by
   * one finds single characters and nothing longer. Runs are joined here instead, but
   * only where the content stream itself says they are consecutive body text: never
   * across content streams, a `BT`/`ET`, a `Td`/`TD`/`Tm`/`T*`, a `'`/`"`, or a font
   * switch (see buildSegments() and scanTextRuns()). Naively concatenating runs would
   * match text drawn in two unrelated places on the page and then rewrite one of them.
   *
   * Returns one entry per occurrence, in document order, each `{ id, text, before,
   * after, runCount, fontName }`. `before`/`after` are up to CONTEXT_RADIUS code points
   * of surrounding text, for telling repeated hits apart. `id` is opaque: pass it back
   * to replaceTextMatch() and do not parse it -- its shape is not part of this API and
   * it is meaningless to any other editor instance. Ids stay valid until the next
   * searchText() call on this editor, which supersedes them.
   *
   * An empty `query` is rejected with `code: "EMPTY_QUERY"` rather than matching every
   * run: a search for nothing is a caller mistake, and answering it with "everything"
   * invites a replace-all against the whole document.
   *
   * `password` is forwarded to listTextRuns() for an encrypted PDF not yet authenticated.
   */
  async searchText(query, password) {
    if (typeof query !== "string") throw searchError("EMPTY_QUERY", "searchText() requires a string query");
    if (query === "") throw searchError("EMPTY_QUERY", "searchText() requires a non-empty query; an empty string matches nothing rather than every text run");
    await this.listTextRuns(password);
    const queryPoints = [...query];
    this.matches.clear();
    const results = [];
    for (const segment of buildSegments(internalRuns(this))) {
      let cursor = 0;
      for (; ; ) {
        const start = indexOfPoints(segment.points, queryPoints, cursor);
        if (start === -1) break;
        const end = start + queryPoints.length;
        const span = segment.entries.filter((entry) => entry.start < end && entry.end > start).map((entry) => ({
          runId: entry.run.id,
          objectNumber: entry.run.objectNumber,
          fontName: entry.run.fontName,
          // Snapshot of the run as it read when this match was found; the staleness
          // check in replaceTextMatch() compares against it.
          runText: entry.run.text,
          charStart: Math.max(0, start - entry.start),
          charEnd: Math.min(entry.end - entry.start, end - entry.start)
        }));
        const id = `${this.matchNamespace}-${this.matchCounter += 1}`;
        const text = segment.points.slice(start, end).join("");
        this.matches.set(id, { id, text, span });
        results.push({
          id,
          text,
          before: segment.points.slice(Math.max(0, start - CONTEXT_RADIUS), start).join(""),
          after: segment.points.slice(end, Math.min(segment.points.length, end + CONTEXT_RADIUS)).join(""),
          // Informational only -- how many text-showing operands this match is drawn
          // as. A caller never needs it to replace the match; the browser PoC shows it.
          runCount: span.length,
          fontName: span[0]?.fontName ?? null
        });
        cursor = end;
      }
    }
    return results;
  }
  /**
   * Supplies a font to fall back on when the document's own fonts cannot write a
   * replacement -- which is whenever it contains a character the document never used,
   * since a PDF's embedded fonts are normally subsetted to just the characters it needed.
   *
   * With one set, checkTextMatchReplacement() and replaceTextMatch() reach for it by
   * themselves: the document's own font is always tried first, and the fallback is used
   * only for text that font cannot express, so nothing that already worked starts
   * embedding a multi-megabyte font. Without one, both behave exactly as they did before
   * this existed. There is no default and nothing is downloaded: `fontBytes` is a
   * TrueType font the caller has loaded however it likes, and the engine makes no network
   * request of any kind.
   *
   * The font is embedded in full when it is first used, which adds its compressed size to
   * the saved file -- a few megabytes for a CJK font. It is embedded once per document
   * however many replacements use it.
   *
   * Throws `code: "FALLBACK_FONT_INVALID"` if the bytes are not a TrueType font, and
   * `code: "FALLBACK_FONT_ALREADY_IN_USE"` if this editor has already written something
   * with a fallback font. Text already replaced holds glyph ids of *that* font, and
   * another font's ids mean different glyphs, so swapping it would silently turn text
   * already written into the wrong characters. Setting a different font before the first
   * replacement is fine.
   */
  async setFallbackFont(fontBytes) {
    if (this.fallbackEmbedding) {
      throw searchError("FALLBACK_FONT_ALREADY_IN_USE", "This editor has already written text with a fallback font; that text holds glyph ids of that font, so it cannot be exchanged for another. Save and reopen to start again with a different font.");
    }
    const fallback = parseFallbackFont(fontBytes);
    fallback.digest = await fingerprintFont(fallback.bytes);
    this.fallbackFont = fallback;
    return this;
  }
  /**
   * Whether replaceTextMatch() would accept `replacement` for this match, decided
   * without changing anything. Returns `{ allowed: true, mode }` or `{ allowed: false,
   * code, reason, unsafeReason? }` -- never throws for a refusal, since a caller asking
   * "may I?" is not making a mistake by asking.
   *
   * `mode` names how the replacement would be written: "single-run" (the match sits in
   * one operand, rewritten whole), "same-length" (each operand gets back the characters
   * it contributed), "delete", or "variable-length-safe" (the length changes and the
   * structure permits it -- see planTextMatchReplacement()).
   *
   * This exists so a caller never has to inspect run counts, `TJ` arrays or operators to
   * decide whether an edit is possible: that judgement needs the content stream, and
   * belongs here. It shares planTextMatchReplacement() with replaceTextMatch(), so its
   * verdict is the same verdict -- including the font encoding, which is attempted here
   * too rather than left to surface only at replacement time.
   */
  async checkTextMatchReplacement(matchId, replacement) {
    await this.listTextRuns();
    const plan = await planTextMatchReplacement(this, matchId, replacement);
    if (!plan.allowed) {
      const result = { allowed: false, mode: null, code: plan.code, reason: plan.reason };
      if (plan.unsafeReason) result.unsafeReason = plan.unsafeReason;
      if (plan.characters?.length) result.characters = plan.characters;
      return result;
    }
    return { allowed: true, mode: plan.mode };
  }
  /**
   * Replaces one match from searchText(), across every run it spans, and stages the
   * result for save() -- so a caller never has to know that the match was split into
   * runs at all, nor call replaceText() once per piece.
   *
   * The verdict and the exact bytes both come from planTextMatchReplacement(), the same
   * decision checkTextMatchReplacement() reports; see it for what is allowed and why.
   * In short:
   *
   * - A match inside a single run is rewritten whole, at any length -- unchanged from
   *   v0.2.1, and unaffected by the multi-run rules below.
   * - A multi-run match of equal length is split back onto its original operands by how
   *   many characters each contributed; a deletion empties each operand's share. Both
   *   keep every operand boundary, so both work whatever sits between the operands.
   * - A multi-run match whose length changes is written only when the operands are
   *   joined by zero `TJ` adjustments or by nothing at all: then the whole replacement
   *   goes into the first operand and the rest are emptied, which the PDF draws exactly
   *   as the single-operand replacement above. Any other structure -- a non-zero
   *   adjustment, a `Tc`/`Tw`/`Tz`/`Tr`, colour or marked-content operator in between --
   *   is refused with `code: "MULTI_RUN_LENGTH_CHANGE_UNSUPPORTED"` rather than
   *   re-spaced, re-flowed or estimated.
   *
   * Prefix and suffix around the match are always preserved. A match whose text has
   * changed since it was found is refused with `code: "MATCH_STALE"` rather than
   * rewriting whatever now sits there. Characters are counted in Unicode code points
   * (`[...text]`), so a surrogate pair counts once; grapheme clusters are not combined.
   *
   * Nothing is staged unless the whole replacement encodes: the updates are built and
   * encoded before any of them is committed, so a character the font cannot express
   * leaves the document untouched instead of half replaced.
   */
  async replaceTextMatch(matchId, replacement) {
    await this.listTextRuns();
    const plan = await planTextMatchReplacement(this, matchId, replacement);
    if (!plan.allowed) throw planError(plan);
    commitPlan(this, plan);
    return this;
  }
  /**
   * The lowest object number no object in this document uses, so a caller adding objects
   * can number them without colliding. Reads the trailer's /Size, which is defined as
   * one past the highest object number in the file.
   */
  async nextObjectNumber() {
    await this.listTextRuns();
    return this.document.size;
  }
  async save() {
    await this.listTextRuns();
    if (!this.pending.size && !this.pendingObjects.size && !this.pendingStreams.size) return this.bytes.slice();
    if (this.security) {
      throw new Error("Saving edits to an encrypted PDF is not supported yet (re-encryption is out of scope for this PR); this PDF can be searched but not saved.");
    }
    const updates = [];
    for (const stream of this.streams) {
      const whole = this.pendingStreams.get(stream.object.number);
      const replacements = whole ? [] : stream.runs.flatMap((_, runIndex) => {
        const bytes = this.pending.get(`${stream.object.number}:${runIndex}`);
        return bytes ? [{ runIndex, bytes }] : [];
      });
      if (!whole && !replacements.length) continue;
      let data = whole ?? replaceTextRuns(stream.decoded, replacements);
      if (filters(stream.object.dictionary)[0] === "FlateDecode") data = await deflate(data);
      updates.push({ ...stream.object, dictionary: replacementDictionary(stream.object.dictionary, data.length), data });
    }
    for (const [number, object] of this.pendingObjects) {
      updates.push({ number, generation: object.generation ?? 0, dictionary: object.dictionary, data: object.data ?? null });
    }
    const chunks = [this.bytes, encoder2.encode(this.bytes.at(-1) === 10 ? "" : "\n")];
    const offsets = [];
    let offset = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    for (const update of updates) {
      const head2 = update.data ? encoder2.encode(`${update.number} ${update.generation} obj
${update.dictionary}
stream
`) : encoder2.encode(`${update.number} ${update.generation} obj
${update.dictionary}
endobj
`);
      const tail = update.data ? encoder2.encode("\nendstream\nendobj\n") : null;
      offsets.push({ number: update.number, generation: update.generation, offset });
      chunks.push(head2);
      offset += head2.length;
      if (update.data) {
        chunks.push(update.data, tail);
        offset += update.data.length + tail.length;
      }
    }
    const xrefOffset = offset;
    chunks.push(encoder2.encode("xref\n"));
    offsets.sort((a, b) => a.number - b.number);
    for (const entry of offsets) {
      chunks.push(encoder2.encode(`${entry.number} 1
${String(entry.offset).padStart(10, "0")} ${String(entry.generation).padStart(5, "0")} n 
`));
    }
    chunks.push(encoder2.encode(
      // /Size is one past the highest object number in the file, so appending objects
      // beyond the original count has to raise it or a reader will not resolve them.
      `trailer
<< /Size ${Math.max(this.document.size, ...offsets.map((entry) => entry.number + 1))} /Root ${this.document.root.number} ${this.document.root.generation} R /Prev ${this.document.previousXref} >>
startxref
${xrefOffset}
%%EOF
`
    ));
    return concat(chunks);
  }
};

// src/version.js
var ENGINE_VERSION = "0.4.0";
export {
  ENGINE_VERSION,
  PdfTextEditor
};
