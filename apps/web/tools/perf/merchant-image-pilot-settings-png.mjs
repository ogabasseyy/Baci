// PNG dimensions with full chunk/CRC structure validation for the pilot
// effective-settings gate: walks every chunk, verifies each CRC-32, and
// requires IDAT plus IEND with no trailing bytes.
const PNG_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function pngCrc32(buffer, start, end) {
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    crc = PNG_CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function pngDimensions(buffer) {
  if (
    buffer.length < 8 ||
    buffer.readUInt32BE(0) !== 0x89504e47 ||
    buffer.readUInt32BE(4) !== 0x0d0a1a0a
  ) {
    throw new Error('not a PNG');
  }
  let offset = 8;
  let dimensions = null;
  let seenIdat = false;
  let first = true;
  for (;;) {
    if (offset + 8 > buffer.length) {
      throw new Error('PNG is truncated');
    }
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const dataEnd = offset + 8 + length;
    if (dataEnd + 4 > buffer.length) {
      throw new Error('PNG is truncated');
    }
    if (
      pngCrc32(buffer, offset + 4, dataEnd) !== buffer.readUInt32BE(dataEnd)
    ) {
      throw new Error(`PNG chunk "${type}" failed its CRC check`);
    }
    if (first) {
      if (type !== 'IHDR' || length !== 13) {
        throw new Error('not a PNG');
      }
      dimensions = {
        height: buffer.readUInt32BE(20),
        width: buffer.readUInt32BE(16),
      };
      if (dimensions.width < 1 || dimensions.height < 1) {
        throw new Error('PNG dimensions must be positive');
      }
      first = false;
    }
    if (type === 'IDAT') {
      seenIdat = true;
    }
    offset = dataEnd + 4;
    if (type === 'IEND') {
      break;
    }
  }
  if (offset !== buffer.length) {
    throw new Error('PNG has trailing bytes after IEND');
  }
  if (!seenIdat) {
    throw new Error('PNG has no image data (IDAT)');
  }
  return dimensions;
}
