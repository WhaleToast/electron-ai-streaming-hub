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

function createOverlayScript() {
  // Create a simple GTK overlay script
  const overlayScript = `#!/usr/bin/env python3
import gi
gi.require_version('Gtk', '3.0')
gi.require_version('Gdk', '3.0')
from gi.repository import Gtk, Gdk, GLib
import subprocess
import sys
import signal

class OverlayWindow(Gtk.Window):
    def __init__(self):
        super().__init__()
        
        # Window setup
        self.set_title("Close Firefox")
        self.set_default_size(100, 100)
        self.set_resizable(False)
        self.set_decorated(False)
        self.set_keep_above(True)
        self.set_skip_taskbar_hint(True)
        self.set_skip_pager_hint(True)
        
        # Position in top-left corner
        self.move(0, 0)
        
        # Make window semi-transparent
        screen = self.get_screen()
        visual = screen.get_rgba_visual()
        if visual:
            self.set_visual(visual)
        self.set_app_paintable(True)
        
        # Create button
        self.button = Gtk.Button()
        self.button.set_label("✕")
        self.button.connect("clicked", self.on_close_clicked)
        
        # Style the button
        css = b"""
        button {
            background: rgba(255, 0, 0, 0.8);
            color: white;
            font-size: 24px;
            font-weight: bold;
            border: none;
            border-radius: 50px;
            min-width: 80px;
            min-height: 80px;
        }
        button:hover {
            background: rgba(255, 0, 0, 1.0);
        }
        """
        
        style_provider = Gtk.CssProvider()
        style_provider.load_from_data(css)
        Gtk.StyleContext.add_provider_for_screen(
            Gdk.Screen.get_default(),
            style_provider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
        )
        
        self.add(self.button)
        
        # Connect drawing signal for transparency
        self.connect("draw", self.on_draw)
        self.connect("delete-event", Gtk.main_quit)
        
        # Show with slight delay and fade in
        self.set_opacity(0.7)
        self.show_all()
        
        # Auto-hide after 3 seconds, show on hover
        GLib.timeout_add(3000, self.fade_out)
        self.connect("enter-notify-event", self.on_mouse_enter)
        self.connect("leave-notify-event", self.on_mouse_leave)
    
    def on_draw(self, widget, cr):
        # Make background transparent
        cr.set_source_rgba(0, 0, 0, 0)
        cr.set_operator(cairo.OPERATOR_SOURCE if 'cairo' in globals() else 0)
        cr.paint()
        return False
    
    def on_close_clicked(self, button):
        # Kill Firefox and quit overlay
        subprocess.run(['pkill', 'firefox'], capture_output=True)
        Gtk.main_quit()
    
    def fade_out(self):
        self.set_opacity(0.3)
        return False
    
    def on_mouse_enter(self, widget, event):
        self.set_opacity(1.0)
    
    def on_mouse_leave(self, widget, event):
        self.set_opacity(0.3)

def signal_handler(sig, frame):
    Gtk.main_quit()

# Handle signals gracefully
signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

# Start the overlay
app = OverlayWindow()
try:
    Gtk.main()
except KeyboardInterrupt:
    pass
`;

  fs.writeFileSync('/tmp/corner_overlay.py', overlayScript);
  exec('chmod +x /tmp/corner_overlay.py');
}

function showCornerOverlay() {
  if (overlayProcess) {
    overlayProcess.kill();
  }
  
  console.log('Starting corner overlay...');
  createOverlayScript();
  
  // Start the overlay process
  overlayProcess = spawn('python3', ['/tmp/corner_overlay.py'], {
    stdio: 'ignore',
    detached: true
  });
  
  overlayProcess.on('error', (error) => {
    console.error('Failed to start overlay:', error);
    // Fallback: create a simpler overlay using xterm
    fallbackOverlay();
  });
}

function fallbackOverlay() {
  // Fallback: create a simple xterm overlay
  const script = `#!/bin/bash
xterm -geometry 10x3+0+0 -bg red -fg white -title "Close" -e "
echo 'Click to close Firefox'
echo 'Press ENTER to close'
read
pkill firefox
" &
`;
  
  fs.writeFileSync('/tmp/simple_overlay.sh', script);
  exec('chmod +x /tmp/simple_overlay.sh');
  exec('/tmp/simple_overlay.sh');
}

function hideCornerOverlay() {
  if (overlayProcess) {
    overlayProcess.kill();
    overlayProcess = null;
  }
  
  // Also kill any fallback overlays
  exec('pkill -f corner_overlay.py');
  exec('pkill -f simple_overlay.sh');
}

function closeFirefoxAndFocusMain() {
  console.log('Closing Firefox and returning to main window');
  
  hideCornerOverlay();
  
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
  
  // Show overlay when Firefox starts
  setTimeout(() => {
    showCornerOverlay();
  }, 2000); // Wait 2 seconds for Firefox to start
  
  // Try Firefox first, then Firefox ESR as fallback
  exec(`firefox --new-window --kiosk "${url}"`, (error) => {
    if (error) {
      console.log('Firefox not found, trying firefox-esr...');
      exec(`firefox-esr --new-window --kiosk "${url}"`, (esrError) => {
        if (esrError) {
          console.error('Firefox not found. Please install Firefox.');
          console.log('Falling back to default browser...');
          hideCornerOverlay();
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

// Clean up on app quit
app.on('before-quit', () => {
  hideCornerOverlay();
  exec('pkill firefox');
});

app.on('window-all-closed', () => {
  hideCornerOverlay();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
