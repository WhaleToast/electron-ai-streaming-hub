const { app, BrowserWindow, ipcMain, shell, screen } = require('electron');
const { exec } = require('child_process');
const path = require('path');

let mainWindow = null;

async function createWindow() {
  // Get screen dimensions
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  mainWindow = new BrowserWindow({
    width: width,
    height: height,
    x: 0,
    y: 0,
    frame: false,  // Remove window frame
    fullscreen: false,  // Don't use fullscreen, use maximized instead
    kiosk: true,  // Use kiosk mode instead
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  
  mainWindow.loadFile('index.html');
  
  // Force window to be on top and maximized
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.maximize();
}

function closeFirefoxAndFocusMain() {
  console.log('Closing Firefox and returning to main window');
  
  // Kill all Firefox processes
  exec('pkill firefox', (error) => {
    if (error) {
      console.log('No Firefox processes to kill or error occurred');
    }
    
    // Bring main window to focus
    if (mainWindow) {
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
      mainWindow.focus();
      mainWindow.show();
      mainWindow.maximize();
    }
  });
}

function launchFirefoxInKioskMode(url) {
  console.log(`Launching Firefox in kiosk mode with URL: ${url}`);
  
  // Try Firefox first, then Firefox ESR as fallback
  exec(`firefox --new-window --kiosk "${url}"`, (error) => {
    if (error) {
      console.log('Firefox not found, trying firefox-esr...');
      exec(`firefox-esr --new-window --kiosk "${url}"`, (esrError) => {
        if (esrError) {
          console.error('Firefox not found. Please install Firefox.');
          console.log('Falling back to default browser...');
          shell.openExternal(url);
        }
      });
    }
  });
}

app.whenReady().then(createWindow);

// Handle requests from the UI to launch apps/URLs
ipcMain.on('launch', (event, data) => {
  if (data.type === 'url') {
    launchFirefoxInKioskMode(data.target);
  } else if (data.type === 'app') {
    exec(data.target, (error) => {
      if (error) {
        console.error(`Error launching ${data.target}:`, error);
      }
    });
  }
});

// Add IPC handler to close Firefox from the renderer
ipcMain.on('close-firefox', () => {
  closeFirefoxAndFocusMain();
});

// Handle window focus events
app.on('browser-window-focus', () => {
  if (mainWindow) {
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
  }
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
