// SPDX-License-Identifier: Apache-2.0
interface DesktopBridge {
  pick(mode: "file" | "directory"): Promise<string | null>;
  preferences(): Promise<Record<string, string>>;
  setPreference(key: string, value: string): Promise<void>;
  getLayout(key: string): Promise<string | null>;
  setLayout(key: string, value: string): Promise<void>;
  recentProject(root: string): Promise<void>;
  onOpenProject(callback: (root: string) => void): () => void;
}
declare global { interface Window { rtlDesktop?: DesktopBridge } }
let preferences: Record<string, string> = {};
export async function initializeDesktop(): Promise<void> {
  if (window.rtlDesktop) preferences = await window.rtlDesktop.preferences();
}
export const preferenceStorage = {
  getItem(key: string): string | null { return window.rtlDesktop ? preferences[key] ?? null : localStorage.getItem(key); },
  setItem(key: string, value: string): void {
    if (!window.rtlDesktop) { localStorage.setItem(key, value); return; }
    preferences[key] = value;
    void window.rtlDesktop.setPreference(key, value).catch(() => { console.error("无法保存桌面偏好设置"); });
  },
};
export const layoutStorage = {
  async getItem(key: string): Promise<string | null> { return window.rtlDesktop ? window.rtlDesktop.getLayout(key) : localStorage.getItem(key); },
  async setItem(key: string, value: string): Promise<void> {
    if (window.rtlDesktop) await window.rtlDesktop.setLayout(key, value); else localStorage.setItem(key, value);
  },
};
