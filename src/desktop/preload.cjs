const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('studio', {
  getLanguage: () => ipcRenderer.invoke('studio:get-language'),
  setLanguage: language => ipcRenderer.invoke('studio:set-language', language),
  showOutput: () => ipcRenderer.invoke('studio:show-output'),
  saveProject: p => ipcRenderer.invoke('studio:save-project', p),
  openProject: () => ipcRenderer.invoke('studio:open-project'),
});
