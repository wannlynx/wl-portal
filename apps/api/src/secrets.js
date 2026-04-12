const crypto = require("crypto");

const PROTOTYPE_ENCRYPTION_KEY = "local-dev-secret";
const ENCRYPTION_KEY_ENV = process.env.PETROLEUM_SECRET_KEY || process.env.APP_ENCRYPTION_KEY || PROTOTYPE_ENCRYPTION_KEY;

function encryptionKey() {
  if (!ENCRYPTION_KEY_ENV) {
    throw new Error("Secret encryption key is missing. Set PETROLEUM_SECRET_KEY or APP_ENCRYPTION_KEY.");
  }
  return crypto.createHash("sha256").update(ENCRYPTION_KEY_ENV, "utf8").digest();
}

function encryptJson(value) {
  const key = encryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64")
  };
}

function decryptJson(payload) {
  const key = encryptionKey();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(String(payload.iv || ""), "base64"));
  decipher.setAuthTag(Buffer.from(String(payload.tag || ""), "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(String(payload.ciphertext || ""), "base64")),
    decipher.final()
  ]);
  return JSON.parse(plaintext.toString("utf8"));
}

module.exports = {
  encryptJson,
  decryptJson
};
