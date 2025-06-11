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
import os

class OverlayWindow(Gtk.Window):
    def __init__(self):
        super().__init__()
        
        print("Creating overlay window...", flush=True)
        
        # Window setup - be more aggressive about staying on top
        self.set_title("Close Firefox")
        self.set_default_size(100, 100)
        self.set_resizable(False)
        self.set_decorated(False)
        self.set_keep_above(True)
        self.set_skip_taskbar_hint(True)
        self.set_skip_pager_hint(True)
        self.set_type_hint(Gdk.WindowTypeHint.DOCK)  # Makes it more likely to stay on top
        
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
        window {
            background: transparent;
        }
        button {
            background: rgba(255, 0, 0, 0.9);
            color: white;
            font-size: 32px;
            font-weight: bold;
            border: 2px solid white;
            border-radius: 50px;
            min-width: 80px;
            min-height: 80px;
        }
        button:hover {
            background: rgba(255, 0, 0, 1.0);
            transform: scale(1.1);
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
        
        # Show immediately
        self.show_all()
        
        # Force window to front periodically
        GLib.timeout_add(1000, self.force_to_front)
        
        print("Overlay window created and shown", flush=True)
    
    def force_to_front(self):
        """Periodically force window to stay on top"""
        self.set_keep_above(True)
        self.present()
        return True  # Continue calling this function
    
    def on_draw(self, widget, cr):
        # Make background transparent
        cr.set_source_rgba(0, 0, 0, 0)
        cr.set_operator(1)  # CAIRO_OPERATOR_SOURCE
        cr.paint()
        return False
    
    def on_close_clicked(self, button):
        print("Close button clicked, killing Firefox...", flush=True)
        # Kill Firefox and quit overlay
        subprocess.run(['pkill', 'firefox'], capture_output=True)
        print("Firefox killed, quitting overlay", flush=True)
        Gtk.main_quit()

def signal_handler(sig, frame):
    print("Signal received, quitting...", flush=True)
    Gtk.main_quit()

# Handle signals gracefully
signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

print("Starting overlay application...", flush=True)

# Start the overlay
app = OverlayWindow()
try:
    print("Starting GTK main loop...", flush=True)
    Gtk.main()
    print("GTK main loop ended", flush=True)
except KeyboardInterrupt:
    print("Keyboard interrupt", flush=True)
    pass
except Exception as e:
    print(f"Error: {e}", flush=True)
`;

  fs.writeFileSync('/tmp/corner_overlay.py', overlayScript);
  exec('chmod +x /tmp/corner_overlay.py');
}

function showCornerOverlay() {
  if (overlayProcess) {
    overlayProcess.kill();
  }
  
  console.log('Starting corner overlay...');
  
  // Use the reliable xterm fallback
  fallbackOverlay();
}

function fallbackOverlay() {
  console.log('Using xterm overlay...');
  
  // Create a better-looking xterm overlay
  const script = `#!/bin/bash
# Kill any existing overlay
pkill -f "CLOSE_FIREFOX"

# Create xterm overlay with better positioning
xterm -geometry 12x4+5+5 \\
      -bg "#CC0000" \\
      -fg white \\
      -title "CLOSE_FIREFOX" \\
      -fn "9x15bold" \\
      -iconic \\
      +sb \\
      -bc \\
      -e "bash -c '
        clear
        echo \"╔══════════╗\"
        echo \"║  CLOSE   ║\"
        echo \"║ FIREFOX  ║\"
        echo \"╚══════════╝\"
        echo \"\"
        echo \"Press ENTER\"
        read
        pkill firefox
        exit
      '" &

# Store PID for cleanup
echo \$! > /tmp/overlay_pid
`;
  
  fs.writeFileSync('/tmp/xterm_overlay.sh', script);
  exec('chmod +x /tmp/xterm_overlay.sh');
  
  overlayProcess = spawn('bash', ['/tmp/xterm_overlay.sh'], {
    stdio: 'ignore',
    detached: false
  });
  
  console.log('Xterm overlay started');
}

function hideCornerOverlay() {
  if (overlayProcess) {
    overlayProcess.kill();
    overlayProcess = null;
  }
  
  // Clean up any remaining overlay processes
  exec('pkill -f CLOSE_FIREFOX');
  exec('pkill -f corner_overlay.py');
  
  // Clean up PID file
  exec('rm -f /tmp/overlay_pid');
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
  
  // Start overlay BEFORE Firefox
  showCornerOverlay();
  
  // Wait a moment then launch Firefox
  setTimeout(() => {
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
  }, 1000); // Wait 1 second before launching Firefox
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
