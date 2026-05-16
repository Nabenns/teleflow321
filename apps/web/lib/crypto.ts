import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export function generateEncryptionKey(): Buffer {
  return randomBytes(KEY_BYTES);
}

export function parseKeyFromBase64(b64: string): Buffer {
  const buf = Buffer.from(b64, "base64");
  if (buf.length !== KEY_BYTES) {
    throw new Error(`encryption key must be 32 bytes, got ${buf.length}`);
  }
  return buf;
}

/**
 * Encrypt a secret with AES-256-GCM. Returned buffer layout:
 *   [nonce (12 bytes)] [ciphertext (N bytes)] [auth tag (16 bytes)]
 */
export function encryptSecret(plaintext: string, key: Buffer): Buffer {
  if (key.length !== KEY_BYTES) {
    throw new Error("encryption key must be 32 bytes");
  }
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, ciphertext, tag]);
}

export function decryptSecret(blob: Buffer, key: Buffer): string {
  if (key.length !== KEY_BYTES) {
    throw new Error("encryption key must be 32 bytes");
  }
  if (blob.length < NONCE_BYTES + TAG_BYTES) {
    throw new Error("ciphertext too short");
  }
  const nonce = blob.subarray(0, NONCE_BYTES);
  const tag = blob.subarray(blob.length - TAG_BYTES);
  const ciphertext = blob.subarray(NONCE_BYTES, blob.length - TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, key, nonce);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
