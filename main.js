const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let overlayProcess = null;
let firefoxLaunched = false; // Track if Firefox is supposed to be running
let stremioLaunched = false; // Track if Stremio is supposed to be running

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
        print("About to kill Firefox and Stremio processes...", flush=True)
        
        # Kill Firefox processes aggressively
        subprocess.run(['pkill', '-f', 'firefox.*kiosk'], capture_output=True)
        subprocess.run(['pkill', 'firefox'], capture_output=True)
        subprocess.run(['killall', 'firefox'], capture_output=True)
        
        # Kill Stremio processes
        subprocess.run(['pkill', 'stremio'], capture_output=True)
        subprocess.run(['killall', 'stremio'], capture_output=True)
        
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
    console.log('Setting all launch flags to false');
    overlayProcess = null;
    
    // Set flags that nothing should be running
    firefoxLaunched = false;
    stremioLaunched = false;
    
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
  
  // Set flags that nothing should be running
  firefoxLaunched = false;
  stremioLaunched = false;
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
      // CRITICAL: Check if Firefox should still be running before handling errors
      if (!firefoxLaunched) {
        console.log('Firefox was killed by user, ignoring exec callback');
        return;
      }
      
      if (error) {
        console.log('Firefox not found, trying firefox-esr...');
        const esrCommand = `DISPLAY=:0 firefox-esr --new-window --kiosk "${url}"`;
        exec(esrCommand, (esrError) => {
          // CRITICAL: Check again before fallback
          if (!firefoxLaunched) {
            console.log('Firefox was killed by user, ignoring ESR callback');
            return;
          }
          
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

function launchStremioFullscreen() {
  console.log(`=== LAUNCH STREMIO CALLED ===`);
  console.log(`stremioLaunched flag: ${stremioLaunched}`);
  
  // Set flag that Stremio is supposed to be running
  stremioLaunched = true;
  
  // Start overlay BEFORE Stremio
  showCornerOverlay();
  
  // Wait a moment then launch Stremio
  setTimeout(() => {
    console.log(`=== ABOUT TO LAUNCH STREMIO ===`);
    console.log(`stremioLaunched flag is now: ${stremioLaunched}`);
    
    // Double-check that we still want to launch Stremio
    if (!stremioLaunched) {
      console.log('Stremio launch cancelled due to flag');
      return;
    }
    
    // Simple approach: just launch stremio
    const command = 'DISPLAY=:0 stremio';
    console.log('Executing:', command);
    
    exec(command, (error, stdout, stderr) => {
      console.log('=== STREMIO EXEC CALLBACK ===');
      console.log('Error:', error);
      console.log('Stdout:', stdout);
      console.log('Stderr:', stderr);
      
      // Check if Stremio should still be running before handling errors
      if (!stremioLaunched) {
        console.log('Stremio was killed by user, ignoring exec callback');
        return;
      }
      
      if (error) {
        console.log('Stremio failed to launch:', error.message);
        // Try flatpak version
        console.log('Trying flatpak version...');
        exec('DISPLAY=:0 flatpak run com.stremio.Stremio', (flatpakError) => {
          if (!stremioLaunched) {
            console.log('Stremio was killed by user, ignoring flatpak callback');
            return;
          }
          
          if (flatpakError) {
            console.error('Flatpak Stremio also failed:', flatpakError.message);
            hideCornerOverlay();
          } else {
            console.log('Flatpak Stremio launched successfully');
            attemptFullscreen();
          }
        });
      } else {
        console.log('Regular Stremio launched successfully');
        attemptFullscreen();
      }
    });
  }, 1000);
  
  function attemptFullscreen() {
    console.log('=== ATTEMPTING FULLSCREEN ===');
    
    // Wait for Stremio to fully load, then try to make it fullscreen
    setTimeout(() => {
      if (!stremioLaunched) {
        console.log('Stremio was killed, skipping fullscreen attempt');
        return;
      }
      
      console.log('Checking if xdotool is available...');
      exec('which xdotool', (whichError) => {
        if (whichError) {
          console.log('xdotool not installed. Please install with: sudo pacman -S xdotool');
          console.log('For now, you can manually press F11 to make Stremio fullscreen');
          return;
        }
        
        console.log('xdotool found, attempting to make Stremio fullscreen...');
        
        // First, let's see what windows are available
        exec('xdotool search --onlyvisible ""', (searchError, searchOutput) => {
          if (searchError) {
            console.log('Could not search for windows:', searchError.message);
            return;
          }
          
          console.log('Available windows:', searchOutput);
          
          // Try to find and activate Stremio window
          exec('xdotool search --sync --onlyvisible --class "stremio" windowactivate', (activateError) => {
            if (activateError) {
              console.log('Could not find Stremio window by class, trying by name...');
              
              exec('xdotool search --sync --onlyvisible --name "Stremio" windowactivate', (nameError) => {
                if (nameError) {
                  console.log('Could not find Stremio window by name either');
                  console.log('Available window names:');
                  exec('xdotool search --onlyvisible "" getwindowname %@', (nameListError, nameList) => {
                    console.log(nameList || 'Could not get window names');
                  });
                  return;
                }
                
                console.log('Found Stremio window by name, sending F11...');
                sendF11ToActiveWindow();
              });
              return;
            }
            
            console.log('Found Stremio window by class, sending F11...');
            sendF11ToActiveWindow();
          });
        });
      });
    }, 4000); // Wait 4 seconds for Stremio to fully load
  }
  
  function sendF11ToActiveWindow() {
    exec('xdotool key F11', (f11Error) => {
      if (f11Error) {
        console.log('F11 failed, trying "f" key...');
        exec('xdotool key f', (fError) => {
          if (fError) {
            console.log('Both F11 and f keys failed:', fError.message);
          } else {
            console.log('Successfully sent "f" key for fullscreen');
          }
        });
      } else {
        console.log('Successfully sent F11 key for fullscreen');
      }
    });
  }
}

app.whenReady().then(createWindow);

// Handle requests from the UI to launch apps/URLs
ipcMain.on('launch', (event, data) => {
  if (data.type === 'url') {
    launchFirefoxInKioskMode(data.target);
  } else if (data.type === 'app') {
    if (data.target === 'stremio') {
      launchStremioFullscreen();
    } else {
      // For other apps, launch normally without overlay
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
  firefoxLaunched = false;
  stremioLaunched = false;
  hideCornerOverlay();
  exec('pkill firefox');
  exec('pkill stremio');
});

app.on('window-all-closed', () => {
  firefoxLaunched = false;
  stremioLaunched = false;
  hideCornerOverlay();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
