const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let overlayProcess = null;
let firefoxLaunched = false; // Track if Firefox is supposed to be running

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
  // Create a proper GTK overlay script with fixed CSS
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
        
        print("Creating overlay window...", flush=True)
        
        # Window setup - aggressive about staying on top
        self.set_title("Close Firefox")
        self.set_default_size(100, 100)
        self.set_resizable(False)
        self.set_decorated(False)
        self.set_keep_above(True)
        self.set_skip_taskbar_hint(True)
        self.set_skip_pager_hint(True)
        
        # Use DOCK type hint - this makes it stay on top of everything
        self.set_type_hint(Gdk.WindowTypeHint.DOCK)
        
        # Position in top-left corner
        self.move(10, 10)
        
        # Make window transparent
        screen = self.get_screen()
        visual = screen.get_rgba_visual()
        if visual and screen.is_composited():
            self.set_visual(visual)
        self.set_app_paintable(True)
        
        # Create button
        self.button = Gtk.Button()
        self.button.set_label("✕")
        self.button.connect("clicked", self.on_close_clicked)
        
        # Fixed CSS without transform property
        css = b"""
        window {
            background: transparent;
        }
        button {
            background: rgba(220, 20, 20, 0.9);
            color: white;
            font-size: 28px;
            font-weight: bold;
            border: 3px solid white;
            border-radius: 40px;
            min-width: 80px;
            min-height: 80px;
        }
        button:hover {
            background: rgba(255, 0, 0, 1.0);
            border: 3px solid yellow;
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
        
        # Connect events
        self.connect("draw", self.on_draw)
        self.connect("delete-event", Gtk.main_quit)
        self.connect("enter-notify-event", self.on_mouse_enter)
        self.connect("leave-notify-event", self.on_mouse_leave)
        
        # Show with full opacity initially
        self.set_opacity(1.0)
        self.show_all()
        
        # Force to top every half second
        GLib.timeout_add(500, self.force_to_top)
        
        # Fade out after 4 seconds (give more time to see it)
        GLib.timeout_add(4000, self.start_fade_out)
        
        print("Overlay window created and shown at full opacity", flush=True)
    
    def force_to_top(self):
        """Aggressively keep window on top"""
        self.set_keep_above(True)
        self.present()
        self.get_window().raise_()
        return True  # Continue calling
    
    def on_draw(self, widget, cr):
        """Make window background transparent"""
        cr.set_source_rgba(0, 0, 0, 0)
        cr.set_operator(1)  # CAIRO_OPERATOR_SOURCE
        cr.paint()
        return False
    
    def start_fade_out(self):
        """Start gradual fade out animation"""
        print("Starting fade out animation", flush=True)
        self.fade_step = 0
        GLib.timeout_add(100, self.fade_step_out)
        return False
    
    def fade_step_out(self):
        """Gradually fade out"""
        self.fade_step += 1
        new_opacity = max(0.3, 1.0 - (self.fade_step * 0.1))
        self.set_opacity(new_opacity)
        
        if new_opacity <= 0.3:
            print(f"Faded to final opacity: {new_opacity}", flush=True)
            return False  # Stop the animation
        
        return True  # Continue fading
    
    def on_mouse_enter(self, widget, event):
        """Show full opacity on hover"""
        self.set_opacity(1.0)
        print("Mouse enter - full opacity", flush=True)
        return False
    
    def on_mouse_leave(self, widget, event):
        """Return to low opacity when mouse leaves"""
        self.set_opacity(0.3)
        print("Mouse leave - low opacity", flush=True)
        return False
    
    def on_close_clicked(self, button):
        print("=== CLOSE BUTTON CLICKED ===", flush=True)
        print("About to kill Firefox processes...", flush=True)
        
        # Kill Firefox processes aggressively
        subprocess.run(['pkill', '-f', 'firefox.*kiosk'], capture_output=True)
        subprocess.run(['pkill', 'firefox'], capture_output=True)
        subprocess.run(['killall', 'firefox'], capture_output=True)
        
        print("All kill commands completed, quitting overlay...", flush=True)
        print("=== OVERLAY QUITTING ===", flush=True)
        Gtk.main_quit()

def signal_handler(sig, frame):
    print("Signal received, quitting...", flush=True)
    Gtk.main_quit()

# Handle signals
signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

print("Starting overlay application...", flush=True)

# Create and run overlay
try:
    app = OverlayWindow()
    Gtk.main()
    print("GTK main loop ended", flush=True)
except Exception as e:
    print(f"Error: {e}", flush=True)
    sys.exit(1)
`;

  fs.writeFileSync('/tmp/corner_overlay.py', overlayScript);
  exec('chmod +x /tmp/corner_overlay.py');
}

function showCornerOverlay() {
  if (overlayProcess) {
    console.log('Killing existing overlay process...');
    overlayProcess.kill();
  }
  
  console.log('=== STARTING OVERLAY ===');
  createOverlayScript();
  
  // Start the GTK overlay process
  overlayProcess = spawn('python3', ['/tmp/corner_overlay.py'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false
  });
  
  overlayProcess.stdout.on('data', (data) => {
    console.log('Overlay:', data.toString().trim());
  });
  
  overlayProcess.stderr.on('data', (data) => {
    console.error('Overlay error:', data.toString().trim());
  });
  
  overlayProcess.on('error', (error) => {
    console.error('Failed to start GTK overlay:', error);
  });
  
  overlayProcess.on('exit', (code) => {
    console.log('=== OVERLAY PROCESS EXITED ===');
    console.log('Exit code:', code);
    console.log('Setting firefoxLaunched to false');
    overlayProcess = null;
    
    // Set flag that Firefox should NOT be running
    firefoxLaunched = false;
    
    // Focus main window when overlay exits (user clicked X)
    setTimeout(() => {
      console.log('=== FOCUSING MAIN WINDOW AFTER OVERLAY EXIT ===');
      if (mainWindow) {
        mainWindow.focus();
        mainWindow.show();
        console.log('Main window focused');
      } else {
        console.log('No main window to focus');
      }
    }, 300);
  });
}

function hideCornerOverlay() {
  if (overlayProcess) {
    overlayProcess.kill();
    overlayProcess = null;
  }
  
  // Clean up any remaining overlay processes
  exec('pkill -f corner_overlay.py');
  
  // Set flag that Firefox should NOT be running
  firefoxLaunched = false;
}

function launchFirefoxInKioskMode(url) {
  console.log(`=== LAUNCH FIREFOX CALLED ===`);
  console.log(`URL: ${url}`);
  console.log(`firefoxLaunched flag: ${firefoxLaunched}`);
  
  // Set flag that Firefox is supposed to be running
  firefoxLaunched = true;
  
  // Start overlay BEFORE Firefox
  showCornerOverlay();
  
  // Wait a moment then launch Firefox
  setTimeout(() => {
    console.log(`=== ABOUT TO LAUNCH FIREFOX ===`);
    console.log(`firefoxLaunched flag is now: ${firefoxLaunched}`);
    
    // Double-check that we still want to launch Firefox
    if (!firefoxLaunched) {
      console.log('Firefox launch cancelled due to flag');
      return;
    }
    
    const firefoxCommand = `DISPLAY=:0 firefox --new-window --kiosk "${url}"`;
    console.log('Executing:', firefoxCommand);
    
    // Try Firefox first, then Firefox ESR as fallback
    exec(firefoxCommand, (error) => {
      if (error) {
        console.log('Firefox not found, trying firefox-esr...');
        const esrCommand = `DISPLAY=:0 firefox-esr --new-window --kiosk "${url}"`;
        exec(esrCommand, (esrError) => {
          if (esrError) {
            console.error('Firefox not found. Please install Firefox.');
            console.log('Falling back to default browser...');
            hideCornerOverlay();
            shell.openExternal(url);
          }
        });
      }
    });
  }, 1000);
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
  firefoxLaunched = false;
  hideCornerOverlay();
  exec('pkill firefox');
});

app.on('window-all-closed', () => {
  firefoxLaunched = false;
  hideCornerOverlay();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
