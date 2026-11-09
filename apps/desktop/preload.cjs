// SPDX-License-Identifier: Apache-2.0
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('rtlDesktop', Object.freeze({
  pick: mode => ipcRenderer.invoke('desktop:pick', mode),
  preferences: () => ipcRenderer.invoke('desktop:prefs'),
  setPreference: (key, value) => ipcRenderer.invoke('desktop:pref', key, value),
  getLayout: key => ipcRenderer.invoke('desktop:layout-get', key),
  setLayout: (key, value) => ipcRenderer.invoke('desktop:layout-set', key, value),
  recentProject: root => ipcRenderer.invoke('desktop:recent', root),
  onOpenProject: callback => {
    const listener = (_event, root) => callback(root);
    ipcRenderer.on('desktop:open-project', listener);
    void ipcRenderer.invoke('desktop:subscribe').catch(() => {});
    return () => ipcRenderer.removeListener('desktop:open-project', listener);
  },
}));
