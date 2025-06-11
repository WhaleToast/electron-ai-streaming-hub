const { app, BrowserWindow, ipcMain, shell, screen } = require('electron');
const { exec } = require('child_process');
const path = require('path');

let mainWindow = null;
let cornerWindow = null;

async function createWindow() {
  mainWindow = new BrowserWindow({
    fullscreen: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  
  mainWindow.loadFile('index.html');
}

function createCornerCloseButton() {
  // Create a small invisible window in the top-left corner
  cornerWindow = new BrowserWindow({
    width: 100,
    height: 100,
    x: 0,
    y: 0,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'corner-preload.js')
    }
  });

  // Load a simple HTML page with a clickable area
  cornerWindow.loadFile('corner.html');
  
  // Hide the window initially
  cornerWindow.hide();
}

function showCornerButton() {
  if (cornerWindow) {
    cornerWindow.show();
    cornerWindow.setAlwaysOnTop(true, 'screen-saver');
  }
}

function hideCornerButton() {
  if (cornerWindow) {
    cornerWindow.hide();
  }
}

function closeFirefoxAndFocusMain() {
  console.log('Closing Firefox and returning to main window');
  
  // Hide the corner button
  hideCornerButton();
  
  // Kill all Firefox processes
  exec('pkill firefox', (error) => {
    if (error) {
      console.log('No Firefox processes to kill or error occurred');
    }
    
    // Bring main window to focus
    if (mainWindow) {
      mainWindow.focus();
      mainWindow.show();
    }
  });
}

function launchFirefoxInKioskMode(url) {
  console.log(`Launching Firefox in kiosk mode with URL: ${url}`);
  
  // Show the corner close button when Firefox launches
  showCornerButton();
  
  // Try Firefox first, then Firefox ESR as fallback
  exec(`firefox --new-window --kiosk "${url}"`, (error) => {
    if (error) {
      console.log('Firefox not found, trying firefox-esr...');
      exec(`firefox-esr --new-window --kiosk "${url}"`, (esrError) => {
        if (esrError) {
          console.error('Firefox not found. Please install Firefox.');
          console.log('Falling back to default browser...');
          hideCornerButton();
          shell.openExternal(url);
        }
      });
    }
  });
}

app.whenReady().then(() => {
  createWindow();
  createCornerCloseButton();
});

// Handle requests from the UI to launch apps/URLs
ipcMain.on('launch', (event, data) => {
  if (data.type === 'url') {
    // Launch Firefox in kiosk mode
    launchFirefoxInKioskMode(data.target);
  } else if (data.type === 'app') {
    // Launch a local app (e.g., Stremio)
    exec(data.target, (error) => {
      if (error) {
        console.error(`Error launching ${data.target}:`, error);
      }
    });
  }
});

// Handle corner button click
ipcMain.on('corner-clicked', () => {
  closeFirefoxAndFocusMain();
});

// Add IPC handler to close Firefox from the renderer
ipcMain.on('close-firefox', () => {
  closeFirefoxAndFocusMain();
});
