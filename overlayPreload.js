const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayAPI', {
    backToHome: () => ipcRenderer.send('show-launcher')
});

