const NONCE_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const NONCE_LENGTH = 32;

export function generateNonce(): string {
  let nonce = '';

  for (let index = 0; index < NONCE_LENGTH; index += 1) {
    nonce += NONCE_CHARACTERS.charAt(Math.floor(Math.random() * NONCE_CHARACTERS.length));
  }

  return nonce;
}
