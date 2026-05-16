import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  generateEncryptionKey,
  parseKeyFromBase64,
} from "../lib/crypto.js";

describe("crypto", () => {
  it("encrypts and decrypts a string roundtrip", () => {
    const key = generateEncryptionKey();
    const plaintext = "1234567890:AAH-secretBotToken";
    const ciphertext = encryptSecret(plaintext, key);
    const decrypted = decryptSecret(ciphertext, key);
    expect(decrypted).toBe(plaintext);
  });

  it("produces different ciphertext for the same plaintext (random nonce)", () => {
    const key = generateEncryptionKey();
    const plaintext = "abc";
    const a = encryptSecret(plaintext, key);
    const b = encryptSecret(plaintext, key);
    expect(a.equals(b)).toBe(false);
  });

  it("fails to decrypt with the wrong key", () => {
    const keyA = generateEncryptionKey();
    const keyB = generateEncryptionKey();
    const ciphertext = encryptSecret("hello", keyA);
    expect(() => decryptSecret(ciphertext, keyB)).toThrow();
  });

  it("fails to decrypt if ciphertext is tampered", () => {
    const key = generateEncryptionKey();
    const ciphertext = encryptSecret("hello", key);
    // Flip last byte (auth tag region)
    ciphertext[ciphertext.length - 1] ^= 0x01;
    expect(() => decryptSecret(ciphertext, key)).toThrow();
  });

  it("parses a 32-byte base64 key", () => {
    const key = generateEncryptionKey();
    const b64 = key.toString("base64");
    const parsed = parseKeyFromBase64(b64);
    expect(parsed.equals(key)).toBe(true);
  });

  it("rejects key with wrong length", () => {
    expect(() => parseKeyFromBase64(Buffer.alloc(16).toString("base64"))).toThrow(
      /must be 32 bytes/,
    );
  });

  it("ciphertext format is nonce(12) + ciphertext + tag(16)", () => {
    const key = generateEncryptionKey();
    const plaintext = "x";
    const ciphertext = encryptSecret(plaintext, key);
    // 12 (nonce) + 1 (encrypted "x") + 16 (auth tag) = 29
    expect(ciphertext.length).toBe(12 + plaintext.length + 16);
  });
});
