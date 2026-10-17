// Minimal ANS-104 type-1 encoder. Web Crypto supplies all cryptography;
// compatibility is checked against arbundles in scripts/analytics.test.mjs.
const utf8 = (value) => new TextEncoder().encode(value);
const concat = (...parts) => {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};
const hash = async (data) => new Uint8Array(await crypto.subtle.digest('SHA-384', data));
async function deepHash(data) {
  if (Array.isArray(data)) {
    let result = await hash(utf8(`list${data.length}`));
    for (const part of data) result = await hash(concat(result, await deepHash(part)));
    return result;
  }
  return hash(concat(await hash(utf8(`blob${data.length}`)), await hash(data)));
}
function avroLong(value) {
  const bytes = [];
  let remaining = value * 2;
  do {
    const byte = remaining % 128;
    remaining = Math.floor(remaining / 128);
    bytes.push(byte | (remaining ? 128 : 0));
  } while (remaining);
  return new Uint8Array(bytes);
}
function uint64(value) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), true);
  return bytes;
}
export async function createSigner() {
  const keys = await crypto.subtle.generateKey(
    {
      name: 'RSA-PSS',
      modulusLength: 4096,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    false,
    ['sign', 'verify'],
  );
  const { n } = await crypto.subtle.exportKey('jwk', keys.publicKey);
  const owner = Uint8Array.from(atob(n.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
    c.charCodeAt(0),
  );
  return { key: keys.privateKey, owner };
}
export async function signDataItem(payload, tags, signer) {
  const parts = [avroLong(tags.length)];
  for (const { name, value } of tags) {
    for (const text of [name, value]) {
      const bytes = utf8(text);
      parts.push(avroLong(bytes.length), bytes);
    }
  }
  parts.push(new Uint8Array([0]));
  const encodedTags = tags.length ? concat(...parts) : new Uint8Array();
  const data = utf8(JSON.stringify(payload));
  if (encodedTags.length > 4096 || data.length > 8192 || signer.owner.length !== 512) {
    throw new Error('Invalid analytics data item');
  }
  const signatureData = await deepHash([
    utf8('dataitem'),
    utf8('1'),
    utf8('1'),
    signer.owner,
    new Uint8Array(),
    new Uint8Array(),
    encodedTags,
    data,
  ]);
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'RSA-PSS', saltLength: 32 }, signer.key, signatureData),
  );
  return concat(
    new Uint8Array([1, 0]),
    signature,
    signer.owner,
    new Uint8Array([0, 0]),
    uint64(tags.length),
    uint64(encodedTags.length),
    encodedTags,
    data,
  );
}
