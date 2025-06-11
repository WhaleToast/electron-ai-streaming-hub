const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let overlayProcess = null;

async function createWindow() {
  mainWindow = new BrowserWindow({
    fullscreen: true,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  
  mainWindow.loadFile('index.html');
}

function startOverlayMonitor() {
  if (overlayProcess) {
    console.log('Killing existing overlay process...');
    overlayProcess.kill();
  }
  
  console.log('=== STARTING OVERLAY MONITOR ===');
  
  // Use the bash script instead of embedded Python
  const scriptPath = path.join(__dirname, 'kiosk-overlay.sh');
  
  // Make sure script is executable
  exec(`chmod +x "${scriptPath}"`);
  
  // Start the overlay monitor
  overlayProcess = spawn('bash', [scriptPath, 'monitor'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    env: { ...process.env, DISPLAY: ':0' }
  });
  
  overlayProcess.stdout.on('data', (data) => {
    console.log('Overlay:', data.toString().trim());
  });
  
  overlayProcess.stderr.on('data', (data) => {
    console.error('Overlay error:', data.toString().trim());
  });
  
  overlayProcess.on('error', (error) => {
    console.error('Failed to start overlay monitor:', error);
  });
  
  overlayProcess.on('exit', (code) => {
    console.log('=== OVERLAY MONITOR EXITED ===');
    console.log('Exit code:', code);
    overlayProcess = null;
    
    // Focus main window when overlay exits
    setTimeout(() => {
      if (mainWindow) {
        mainWindow.focus();
        mainWindow.show();
      }
    }, 300);
  });
}

function stopOverlayMonitor() {
  if (overlayProcess) {
    overlayProcess.kill();
    overlayProcess = null;
  }
  
  // Also run cleanup script
  const scriptPath = path.join(__dirname, 'kiosk-overlay.sh');
  exec(`bash "${scriptPath}" close`);
}

function launchFirefoxInKioskMode(url) {
  console.log(`=== LAUNCHING FIREFOX IN KIOSK MODE ===`);
  console.log(`URL: ${url}`);
  
  // Start overlay monitor
  startOverlayMonitor();
  
  // Launch Firefox after a short delay
  setTimeout(() => {
    const firefoxCommand = `DISPLAY=:0 firefox --new-window --kiosk "${url}"`;
    console.log('Executing:', firefoxCommand);
    
    exec(firefoxCommand, (error) => {
      if (error) {
        console.log('Firefox not found, trying firefox-esr...');
        const esrCommand = `DISPLAY=:0 firefox-esr --new-window --kiosk "${url}"`;
        exec(esrCommand, (esrError) => {
          if (esrError) {
            console.error('Firefox not found. Please install Firefox.');
            console.log('Falling back to default browser...');
            stopOverlayMonitor();
            shell.openExternal(url);
          }
        });
      }
    });
  }, 1000);
}

function launchStremioFullscreen() {
  console.log(`=== LAUNCHING STREMIO FULLSCREEN ===`);
  
  // Start overlay monitor
  startOverlayMonitor();
  
  // Launch Stremio after a short delay
  setTimeout(() => {
    const stremioProcess = spawn('stremio', [], {
      env: { ...process.env, DISPLAY: ':0' },
      detached: true,
      stdio: 'ignore'
    });
    
    stremioProcess.on('error', (error) => {
      console.log('Regular Stremio failed, trying flatpak...');
      const flatpakProcess = spawn('flatpak', ['run', 'com.stremio.Stremio'], {
        env: { ...process.env, DISPLAY: ':0' },
        detached: true,
        stdio: 'ignore'
      });
      
      flatpakProcess.on('error', (flatpakError) => {
        console.error('Both Stremio versions failed');
        stopOverlayMonitor();
      });
    });
    
    // Try to make Stremio fullscreen after it loads
    setTimeout(() => {
      attemptFullscreen();
    }, 3000);
  }, 1000);
}

function attemptFullscreen() {
  exec('which xdotool', (whichError) => {
    if (whichError) {
      console.log('xdotool not available for fullscreen control');
      return;
    }
    
    // Search for Stremio window and send F11
    exec('xdotool search --onlyvisible --name "Stremio"', (error, output) => {
      if (!error && output.trim()) {
        const windowId = output.trim().split('\n')[0];
        exec(`xdotool windowactivate ${windowId} && sleep 0.5 && xdotool key --window ${windowId} F11`);
      }
    });
  });
}

app.whenReady().then(createWindow);

// Handle requests from the UI
ipcMain.on('launch', (event, data) => {
  if (data.type === 'url') {
    launchFirefoxInKioskMode(data.target);
  } else if (data.type === 'app') {
    if (data.target === 'stremio') {
      launchStremioFullscreen();
    } else {
      exec(data.target, (error) => {
        if (error) {
          console.error(`Error launching ${data.target}:`, error);
        }
      });
    }
  }
});

// Clean up on app quit
app.on('before-quit', () => {
  stopOverlayMonitor();
});

app.on('window-all-closed', () => {
  stopOverlayMonitor();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
