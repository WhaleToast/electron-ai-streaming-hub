const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
    launchService: (serviceId) => ipcRenderer.invoke('launch-service', serviceId),
    quitApp: () => ipcRenderer.invoke('quit-app'),
    getServices: () => ipcRenderer.invoke('get-services'),
    
    // Listen for services data
    onServicesData: (callback) => {
        ipcRenderer.on('services-data', callback);
    }
});
