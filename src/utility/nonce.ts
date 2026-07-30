import { randomBytes } from 'node:crypto';

const NONCE_BYTE_LENGTH = 16;

export function createNonce(): string {
  return randomBytes(NONCE_BYTE_LENGTH).toString('base64url');
}
