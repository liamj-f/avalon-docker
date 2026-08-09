// Deliberately excludes visually ambiguous characters (0/O, 1/I).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(length = 5) {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

function generateUniqueCode(existingCodes, length = 5) {
  let code = randomCode(length);
  let attempts = 0;
  while (existingCodes.has(code) && attempts < 50) {
    code = randomCode(length);
    attempts += 1;
  }
  return code;
}

module.exports = { generateUniqueCode };
