const { app, BrowserWindow, ipcMain } = require('electron');
const { exec } = require('child_process');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    fullscreen: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.loadFile('index.html');
}

app.whenReady().then(createWindow);

// Handle requests from the UI to launch apps/URLs
ipcMain.on('launch', (event, data) => {
  if (data.type === 'url') {
    // Open new fullscreen Electron window with the URL
    const urlWin = new BrowserWindow({
      fullscreen: true,
    });
    urlWin.loadURL(data.target);
  } else if (data.type === 'app') {
    // Launch a local app (e.g., Stremio)
    exec(data.target, (error) => {
      if (error) {
        console.error(`Error launching ${data.target}:`, error);
      }
    });
  }
});

