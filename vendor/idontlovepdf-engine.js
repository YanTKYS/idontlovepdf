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
function scanTextRuns(bytes, context = "") {
  const strings = [];
  const runs = [];
  let cursor = 0;
  let inText = false;
  let currentFont = null;
  let lastName = null;
  let textObjectId = -1;
  let continuityId = 0;
  while (cursor < bytes.length) {
    cursor = skipWhite(bytes, cursor);
    if (cursor >= bytes.length) break;
    if (bytes[cursor] === 40) {
      const token = withStreamContext(() => readLiteral(bytes, cursor), bytes, cursor, context);
      strings.push({ ...token, start: cursor });
      cursor = token.end;
      continue;
    }
    if (bytes[cursor] === 60 && bytes[cursor + 1] === 60) {
      cursor = withStreamContext(() => skipDictionary(bytes, cursor), bytes, cursor, context);
      continue;
    }
    if (bytes[cursor] === 60) {
      const token = withStreamContext(() => readHex(bytes, cursor), bytes, cursor, context);
      strings.push({ ...token, start: cursor });
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
    if (NUMBER.test(operator)) continue;
    if (operator === "BI") {
      cursor = skipInlineImage(bytes, cursor);
      strings.length = 0;
      lastName = null;
      continuityId += 1;
    } else if (operator === "BT") {
      inText = true;
      currentFont = null;
      textObjectId += 1;
      strings.length = 0;
      continuityId += 1;
    } else if (operator === "ET") {
      inText = false;
      strings.length = 0;
      continuityId += 1;
    } else if (inText && operator === "Tf") {
      if (lastName !== currentFont) continuityId += 1;
      currentFont = lastName;
      strings.length = 0;
    } else if (inText && (operator === "Tj" || operator === "'" || operator === '"' || operator === "TJ")) {
      if (operator === "'" || operator === '"') continuityId += 1;
      for (const string of strings) runs.push({ ...string, fontName: currentFont, textObjectId, continuityId });
      strings.length = 0;
    } else {
      strings.length = 0;
      lastName = null;
      if (!CONTINUITY_SAFE_OPERATORS.has(operator)) continuityId += 1;
    }
  }
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
      const line = decodeBinaryString(bytes.subarray(cursor, lineEnd));
      const match = line.match(/^(\d{10})\s+(\d{5})\s+([nf])/);
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
function subBytes(state, table) {
  for (let index = 0; index < 16; index += 1) state[index] = table[state[index]];
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
function subtle() {
  const value = globalThis.crypto?.subtle;
  if (!value) throw new Error("Web Crypto API (crypto.subtle) is not available in this environment");
  return value;
}
async function digest(algorithm, bytes) {
  return new Uint8Array(await subtle().digest(algorithm, bytes));
}
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
function subtle2() {
  const value = globalThis.crypto?.subtle;
  if (!value) throw new Error("Web Crypto API (crypto.subtle) is not available in this environment");
  return value;
}
async function decryptAesCbc(key, ivAndCiphertext) {
  if (ivAndCiphertext.length < 16) throw new Error("AES-CBC data is shorter than one IV block (16 bytes)");
  const iv = ivAndCiphertext.subarray(0, 16);
  const ciphertext = ivAndCiphertext.subarray(16);
  if (ciphertext.length === 0 || ciphertext.length % 16 !== 0) {
    throw new Error("AES-CBC ciphertext length is not a multiple of the 16-byte block size");
  }
  const cryptoKey = await subtle2().importKey("raw", key, { name: "AES-CBC" }, false, ["decrypt"]);
  try {
    const plain = await subtle2().decrypt({ name: "AES-CBC", iv }, cryptoKey, ciphertext);
    return new Uint8Array(plain);
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
var encoder = new TextEncoder();
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
      fontName: run.fontName,
      text: decodeWithCMap(editor.pending.get(id) ?? run.value, mappings)
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
function encodeReplacement(editor, run, replacement) {
  if (typeof replacement !== "string") return Uint8Array.from(replacement);
  const stream = editor.streams.find((candidate) => candidate.object.number === run.objectNumber);
  const mappings = stream.fontMaps.get(run.fontName);
  return mappings ? encodeWithCMap(replacement, mappings) : encodeSingleByte(replacement);
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
async function loadFontMaps(resources, structure, security) {
  const result = /* @__PURE__ */ new Map();
  for (const [name, fontReference] of await fontReferences(resources, structure, security)) {
    const font = await structure.resolveObject(fontReference, security, decryptStreamBytes);
    const toUnicode = reference(font.dictionary, "ToUnicode");
    if (!toUnicode) continue;
    const cmapObject = structure.object(toUnicode);
    result.set(name, parseToUnicodeCMap(await decodeStream(cmapObject, "ToUnicode stream", security)));
  }
  return result;
}
var PdfTextEditor = class {
  constructor(input) {
    this.bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (latin13.decode(this.bytes.subarray(0, 5)) !== "%PDF-") throw new Error("Input is not a PDF document");
    this.document = new PdfStructure(this.bytes);
    this.streams = null;
    this.pending = /* @__PURE__ */ new Map();
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
        if (runs.length) this.streams.push({ object, decoded, runs, fontMaps: await loadFontMaps(resources, this.document, this.security) });
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
   * Replaces one match from searchText(), across every run it spans, and stages the
   * result for save() -- so a caller never has to know that the match was split into
   * runs at all, nor call replaceText() once per piece.
   *
   * The match is re-checked against the document first: each run it covers must still
   * read exactly as it did when the match was found, or this throws `code:
   * "MATCH_STALE"` and stages nothing. Rewriting the wrong place because an id outlived
   * the text it described is the one failure worth refusing outright.
   *
   * What is replaced, and what is kept:
   *
   * - A match inside a single run goes through the same whole-run rewrite that
   *   replaceText() has always done, rebuilt as `prefix + replacement + suffix`, so the
   *   parts of that run outside the match survive and single-run behaviour is unchanged.
   * - A match spanning several runs is split back onto those runs by how many characters
   *   each one contributed: run "申請は令" + "和6年" + "度です" replaced 令和6年度 →
   *   令和7年度 becomes "申請は令" + "和7年" + "度です". Every string operand, every
   *   `TJ` numeric adjustment, and the operator structure around them stay as they were
   *   -- nothing is re-spaced, re-flowed, or re-computed.
   * - An empty `replacement` deletes the matched text: each run keeps its prefix and
   *   suffix, and a run lying wholly inside the match becomes an empty string operand.
   *   The operand stays in place rather than the content stream being rebuilt around
   *   its removal, which keeps this an ordinary incremental update.
   *
   * Refused, explicitly and with a stable `code`, rather than guessed at:
   *
   * - A multi-run replacement whose character count differs from the match's, other
   *   than deletion: `MULTI_RUN_LENGTH_CHANGE_UNSUPPORTED`. There is no way to divide
   *   the extra (or missing) characters over the original operands without moving text
   *   relative to the `TJ` adjustments that space it, i.e. without changing where
   *   characters land on the page. Replace inside a single run, or delete, instead.
   * - A multi-run match spanning more than one font: `MULTI_RUN_FONT_CHANGE_UNSUPPORTED`.
   *   Each piece would have to be encoded through a different CMap. Search already
   *   breaks continuity at a font switch, so this is a backstop, not a common path.
   *
   * Characters are counted in Unicode code points (`[...text]`), so a surrogate pair
   * counts once and never as two. Grapheme clusters are not combined.
   */
  async replaceTextMatch(matchId, replacement) {
    await this.listTextRuns();
    if (this.security && this.security.modifyAllowed === false) {
      throw new Error("Document modification is not permitted: this PDF's /P permissions disallow content changes (modify permission denied)");
    }
    if (typeof replacement !== "string") {
      throw searchError("REPLACEMENT_NOT_A_STRING", "replaceTextMatch() takes the replacement as a string; use replaceText() to write raw font-encoded bytes to a single run");
    }
    const match = this.matches.get(matchId);
    if (!match) {
      throw searchError("UNKNOWN_MATCH", `Unknown search match: ${matchId} (match ids come from this editor's most recent searchText() call and are superseded by the next one)`);
    }
    const current = new Map(internalRuns(this).map((run) => [run.id, run]));
    for (const entry of match.span) {
      if (current.get(entry.runId)?.text !== entry.runText) {
        throw searchError("MATCH_STALE", `This match is stale: the text it was found in has changed since searchText() returned it (run ${entry.runId}). Search again and replace the new match.`);
      }
    }
    const replacementPoints = [...replacement];
    let chunks;
    if (match.span.length === 1) {
      chunks = [replacementPoints];
    } else {
      const fonts = new Set(match.span.map((entry) => entry.fontName));
      if (fonts.size > 1) {
        throw searchError("MULTI_RUN_FONT_CHANGE_UNSUPPORTED", `This match spans ${fonts.size} fonts; replacing it would have to encode its characters through more than one font, which is not supported`);
      }
      const matchLength = [...match.text].length;
      if (replacementPoints.length && replacementPoints.length !== matchLength) {
        throw searchError(
          "MULTI_RUN_LENGTH_CHANGE_UNSUPPORTED",
          `This match is drawn as ${match.span.length} separate text runs, so a replacement of ${replacementPoints.length} characters cannot be written over ${matchLength} without moving text relative to the PDF's own spacing. Use an equal-length replacement, or an empty one to delete.`
        );
      }
      let cursor = 0;
      chunks = match.span.map((entry) => {
        const contributed = entry.charEnd - entry.charStart;
        const chunk = replacementPoints.length ? replacementPoints.slice(cursor, cursor + contributed) : [];
        cursor += contributed;
        return chunk;
      });
    }
    const staged = [];
    match.span.forEach((entry, index) => {
      const points = [...entry.runText];
      const text = points.slice(0, entry.charStart).join("") + chunks[index].join("") + points.slice(entry.charEnd).join("");
      if (text === entry.runText) return;
      staged.push({ id: entry.runId, bytes: encodeReplacement(this, entry, text) });
    });
    for (const { id, bytes } of staged) this.pending.set(id, bytes);
    return this;
  }
  async save() {
    await this.listTextRuns();
    if (!this.pending.size) return this.bytes.slice();
    if (this.security) {
      throw new Error("Saving edits to an encrypted PDF is not supported yet (re-encryption is out of scope for this PR); this PDF can be searched but not saved.");
    }
    const updates = [];
    for (const stream of this.streams) {
      const replacements = stream.runs.flatMap((_, runIndex) => {
        const bytes = this.pending.get(`${stream.object.number}:${runIndex}`);
        return bytes ? [{ runIndex, bytes }] : [];
      });
      if (!replacements.length) continue;
      let data = replaceTextRuns(stream.decoded, replacements);
      if (filters(stream.object.dictionary)[0] === "FlateDecode") data = await deflate(data);
      updates.push({ ...stream.object, dictionary: replacementDictionary(stream.object.dictionary, data.length), data });
    }
    const chunks = [this.bytes, encoder.encode(this.bytes.at(-1) === 10 ? "" : "\n")];
    const offsets = [];
    let offset = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    for (const update of updates) {
      const head = encoder.encode(`${update.number} ${update.generation} obj
${update.dictionary}
stream
`);
      const tail = encoder.encode("\nendstream\nendobj\n");
      offsets.push({ number: update.number, generation: update.generation, offset });
      chunks.push(head, update.data, tail);
      offset += head.length + update.data.length + tail.length;
    }
    const xrefOffset = offset;
    chunks.push(encoder.encode("xref\n"));
    offsets.sort((a, b) => a.number - b.number);
    for (const entry of offsets) {
      chunks.push(encoder.encode(`${entry.number} 1
${String(entry.offset).padStart(10, "0")} ${String(entry.generation).padStart(5, "0")} n 
`));
    }
    chunks.push(encoder.encode(
      `trailer
<< /Size ${this.document.size} /Root ${this.document.root.number} ${this.document.root.generation} R /Prev ${this.document.previousXref} >>
startxref
${xrefOffset}
%%EOF
`
    ));
    return concat(chunks);
  }
};

// src/version.js
var ENGINE_VERSION = "0.2.1";
export {
  ENGINE_VERSION,
  PdfTextEditor
};
