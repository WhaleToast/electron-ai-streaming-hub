const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    launchService: (serviceId) => ipcRenderer.invoke('launch-service', serviceId),
    quitApp: () => ipcRenderer.invoke('quit-app'),
    getServices: () => ipcRenderer.invoke('get-services'),
    shutdown: () => ipcRenderer.invoke('shutdown'),
    restart: () => ipcRenderer.invoke('restart'),

    onServicesData: (callback) => {
        ipcRenderer.on('services-data', callback);
    }
});

