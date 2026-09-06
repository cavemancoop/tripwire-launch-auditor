import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM for the Orbio OAuth token at rest (`.env` `TOKEN_ENCRYPTION_KEY`,
 * 32 bytes base64). The token never touches the DB or logs in plaintext; only
 * this module holds it decrypted, briefly, to hand to the MCP client.
 *
 * Wire format (base64): [12-byte IV][16-byte auth tag][ciphertext].
 */
const IV_LEN = 12;
const TAG_LEN = 16;

export function loadEncryptionKey(base64Key: string | undefined): Buffer {
  if (!base64Key) throw new Error('TOKEN_ENCRYPTION_KEY is not set');
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) {
    throw new Error(`TOKEN_ENCRYPTION_KEY must decode to 32 bytes (got ${key.length})`);
  }
  return key;
}

export function encryptToken(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptToken(wire: string, key: Buffer): string {
  const buf = Buffer.from(wire, 'base64');
  if (buf.length < IV_LEN + TAG_LEN + 1) throw new Error('ciphertext too short');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

/** first 12 hex chars of sha256(token) — safe to log / store as `keyHashPrefix`. */
export async function keyHashPrefix(token: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(token).digest('hex').slice(0, 12);
}

/** Generate a fresh 32-byte key, base64 — for `.env` setup. */
export function generateEncryptionKey(): string {
  return randomBytes(32).toString('base64');
}
