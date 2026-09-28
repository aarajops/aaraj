# 03 - Encryption & Hashing

> **Source Reference**: [NestJS Official Documentation - Encryption and Hashing](https://docs.nestjs.com/security/encryption-and-hashing)

Cryptographic operations in secure enterprise applications fulfill two distinct, non-interchangeable purposes:
1. **Symmetric Encryption (Two-Way)**: Reversibly transforms sensitive data (e.g. PII, SSNs, payment tokens) into ciphertext. It can be decrypted back into plaintext by authorized parties possessing the cryptographic key.
2. **Cryptographic Hashing (One-Way)**: Irreversibly transforms arbitrary inputs into fixed-length digest strings. It is impossible to reverse. It is used for verifying passwords and data integrity.

---

## 1. Symmetric Encryption with `node:crypto`

NestJS relies directly on Node.js's built-in `node:crypto` module without third-party wrapper bloat.

### Recommended Algorithm: `aes-256-gcm` or `aes-256-ctr`

Always use a unique Initialization Vector (IV) for every encryption operation. Reusing an IV with the same key breaks the cipher's security.

```typescript
// src/common/crypto/encryption.service.ts
import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';

@Injectable()
export class EncryptionService {
  private readonly algorithm = 'aes-256-ctr';
  private readonly secretKey = process.env.ENCRYPTION_KEY ?? 'aaraj-super-secret-key-32-chars';

  async encrypt(plainText: string): Promise<string> {
    // 1. Generate unique 16-byte IV for every encryption call
    const iv = randomBytes(16);

    // 2. Derive 32-byte key using scrypt
    const key = (await promisify(scrypt)(this.secretKey, 'salt', 32)) as Buffer;

    // 3. Create cipher instance
    const cipher = createCipheriv(this.algorithm, key, iv);

    // 4. Encrypt data
    const encrypted = Buffer.concat([
      cipher.update(plainText, 'utf8'),
      cipher.final(),
    ]);

    // Format: iv_hex:encrypted_hex
    return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
  }

  async decrypt(encryptedData: string): Promise<string> {
    const [ivHex, cipherHex] = encryptedData.split(':');
    if (!ivHex || !cipherHex) {
      throw new Error('Malformed encrypted payload');
    }

    const iv = Buffer.from(ivHex, 'hex');
    const key = (await promisify(scrypt)(this.secretKey, 'salt', 32)) as Buffer;

    const decipher = createDecipheriv(this.algorithm, key, iv);
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(cipherHex, 'hex')),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }
}
```

---

## 2. Password Hashing with `bcrypt`

User passwords must **never** be encrypted with reversible encryption; they must be hashed using a slow, salted, one-way cryptographic hash algorithm like **bcrypt** or **argon2**.

### Installation

```bash
pnpm --filter @aaraj/api add bcrypt
pnpm --filter @aaraj/api add -D @types/bcrypt
```

### Implementing `HashingService`

```typescript
// src/common/crypto/hashing.service.ts
import { Injectable } from '@nestjs/common';
import bcrypt from 'bcrypt';

@Injectable()
export class HashingService {
  // 10-12 salt rounds is optimal for server performance and brute-force resistance
  private readonly saltRounds = 10;

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.saltRounds);
  }

  async comparePassword(password: string, hash: string): Promise<boolean> {
    // Uses constant-time string comparison to prevent timing attacks
    return bcrypt.compare(password, hash);
  }
}
```

---

## 3. Alternative: Argon2 (OWASP Recommended)

[Argon2](https://github.com/ranisalt/node-argon2) is the winner of the Password Hashing Competition and the algorithm officially recommended by OWASP for password storage due to its memory-hard design, making GPU-based brute-forcing impractical.

### Installation

```bash
pnpm --filter @aaraj/api add argon2
```

### Argon2 Usage

```typescript
import argon2 from 'argon2';

// Hashing:
const hash = await argon2.hash('myUserPassword', {
  type: argon2.argon2id, // Hybrid version resistant to both side-channel and GPU attacks
  memoryCost: 2 ** 16,    // 64 MB
  timeCost: 3,
});

// Verification:
const isMatch = await argon2.verify(hash, 'myUserPassword');
```

---

## 4. Cryptographic Security Checklist

| Threat | Vulnerability | Architectural Defense |
| :--- | :--- | :--- |
| **Rainbow Table Lookups** | Fast hashes without salts (MD5, SHA-256) | Use `bcrypt` or `argon2id` which generate cryptographically random salts per hash. |
| **GPU Brute-Force Attacks** | Low-cost computation | High computational cost factor (salt rounds >= 10 in bcrypt, memory cost in argon2). |
| **Timing Attacks** | Early character exit comparisons | Use `bcrypt.compare()` or `crypto.timingSafeEqual()` which guarantee constant-time evaluation. |
| **Key/IV Reuse in AES** | Static initialization vectors | Call `crypto.randomBytes(16)` on every single encryption call. |
