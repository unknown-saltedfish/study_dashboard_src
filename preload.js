const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('retroAPI', {
  getState: () => ipcRenderer.invoke('get-state'),
  saveState: (state) => ipcRenderer.invoke('save-state', state),
  selectLocalDirectory: () => ipcRenderer.invoke('select-local-directory'),
  toggleTypewriter: (enable) => ipcRenderer.invoke('toggle-typewriter', enable),
  setTypewriterHeight: (h) => ipcRenderer.invoke('set-typewriter-height', h),
  setIgnoreMouseEvents: (ignore, options) => ipcRenderer.send('set-ignore-mouse-events', ignore, options),
  
  // FIXED: Added local native file-url conversion bridge
  pathToFileUrl: (filePath) => ipcRenderer.invoke('path-to-file-url', filePath),
  
  onStateUpdated: (callback) => {
    const sub = (_, state) => callback(state);
    ipcRenderer.on('state-updated', sub);
    return () => ipcRenderer.removeListener('state-updated', sub);
  }
});