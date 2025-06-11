const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  cornerClicked: () => ipcRenderer.send('corner-clicked')
});
