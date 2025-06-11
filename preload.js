const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  launch: (data) => ipcRenderer.send('launch', data),
});

