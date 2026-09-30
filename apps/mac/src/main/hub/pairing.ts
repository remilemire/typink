// Pairing: the Mac shows a 6-digit code; an iPad that enters it gets a random
// token it presents on every later connection. Only token hashes are stored.

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { SettingsStore, StoredDevice } from '../settings';

const MAX_FAILURES = 5;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export class Pairing {
  private failures = 0;
  code = newCode();

  constructor(private readonly settings: SettingsStore) {}

  get devices(): StoredDevice[] {
    return this.settings.devices;
  }

  verify(deviceId: string, token: string): boolean {
    const device = this.settings.devices.find((d) => d.id === deviceId);
    if (!device) return false;
    const a = Buffer.from(device.tokenHash, 'hex');
    const b = Buffer.from(hash(token), 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** Checks a code; on success registers the device and returns its new token. */
  attempt(deviceId: string, name: string, code: string): { ok: true; token: string } | { ok: false; reason: string } {
    if (code !== this.code) {
      this.failures++;
      if (this.failures >= MAX_FAILURES) {
        this.rotate();
        return { ok: false, reason: 'Too many wrong codes. A new code is shown on your Mac.' };
      }
      return { ok: false, reason: 'That code doesn’t match the one on your Mac.' };
    }
    const token = randomBytes(24).toString('base64url');
    const others = this.settings.devices.filter((d) => d.id !== deviceId);
    this.settings.setDevices([...others, { id: deviceId, name, tokenHash: hash(token), pairedAt: Date.now() }]);
    this.rotate();
    return { ok: true, token };
  }

  revoke(deviceId: string): void {
    this.settings.setDevices(this.settings.devices.filter((d) => d.id !== deviceId));
  }

  rotate(): void {
    this.code = newCode();
    this.failures = 0;
  }
}

function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}
