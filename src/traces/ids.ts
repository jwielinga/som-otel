// Falls back to Math.random where Web Crypto is missing; ids only need to be unique, not secret.
function fillRandom(bytes: Uint8Array<ArrayBuffer>): void {
  const webCrypto = (globalThis as { crypto?: Crypto }).crypto
  if (typeof webCrypto?.getRandomValues === 'function') {
    webCrypto.getRandomValues(bytes)
    return
  }
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Math.floor(Math.random() * 256)
  }
}

// W3C Trace Context forbids all-zero ids, so regenerate until at least one byte is set.
function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength)
  do {
    fillRandom(bytes)
  } while (bytes.every((byte) => byte === 0))

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  )
}

export function generateTraceId(): string {
  return randomHex(16)
}

export function generateSpanId(): string {
  return randomHex(8)
}
