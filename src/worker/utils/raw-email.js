const RAW_EMAIL_PREFIX = 'base64:';
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

function toUint8Array(input) {
  if (input instanceof Uint8Array) {
    return input;
  }

  return new Uint8Array(input);
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

export function serializeRawEmail(rawEmailBuffer) {
  const bytes = toUint8Array(rawEmailBuffer);
  return `${RAW_EMAIL_PREFIX}${bytesToBase64(bytes)}`;
}

export function decodeRawEmailText(bytes) {
  return textDecoder.decode(bytes);
}

export function deserializeRawEmail(storedValue = '') {
  if (storedValue.startsWith(RAW_EMAIL_PREFIX)) {
    const bytes = base64ToBytes(storedValue.slice(RAW_EMAIL_PREFIX.length));
    return {
      bytes,
      rawText: decodeRawEmailText(bytes),
      encoding: 'base64'
    };
  }

  const bytes = textEncoder.encode(storedValue);
  return {
    bytes,
    rawText: storedValue,
    encoding: 'legacy-text'
  };
}

export function toArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
