// App settings and paired iPads, persisted as JSON in the app's userData folder.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import type { AppSettings } from '@shared/types';

export interface StoredDevice {
  id: string;
  name: string;
  /** sha256 of the device token; the token itself only lives on the iPad. */
  tokenHash: string;
  pairedAt: number;
}

interface StoredState {
  settings: AppSettings;
  devices: StoredDevice[];
}

const defaults = (): StoredState => ({
  settings: {
    libraryRoot: process.env.TYPINK_LIBRARY ?? path.join(os.homedir(), 'Documents', 'Typink'),
    appearance: 'system',
    paperFollowsTheme: true,
    hubPort: Number(process.env.TYPINK_PORT) || 47321,
    lastNote: null,
    viewMode: 'split',
    sidebar: true,
  },
  devices: [],
});

export class SettingsStore {
  private state: StoredState;
  private readonly file: string;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(file = path.join(app.getPath('userData'), 'settings.json')) {
    this.file = file;
    this.state = defaults();
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<StoredState>;
      this.state = {
        settings: { ...this.state.settings, ...raw.settings },
        devices: Array.isArray(raw.devices) ? raw.devices : [],
      };
    } catch {
      // First launch or unreadable file: start from defaults.
    }
  }

  get settings(): AppSettings {
    return this.state.settings;
  }

  update(patch: Partial<AppSettings>): AppSettings {
    this.state.settings = { ...this.state.settings, ...patch };
    this.scheduleSave();
    return this.state.settings;
  }

  get devices(): StoredDevice[] {
    return this.state.devices;
  }

  setDevices(devices: StoredDevice[]): void {
    this.state.devices = devices;
    this.scheduleSave();
  }

  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmp, this.file);
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 300);
  }
}
