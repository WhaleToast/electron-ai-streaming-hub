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
        
        # Window setup - DOCK type with strut to stay above fullscreen apps
        self.set_title("Close Firefox")
        self.set_default_size(100, 100)
        self.set_resizable(False)
        self.set_decorated(False)
        self.set_keep_above(True)
        self.set_skip_taskbar_hint(True)
        self.set_skip_pager_hint(True)
        self.set_accept_focus(False)  # This prevents stealing focus!
        self.set_focus_on_map(False)  # Don't take focus when shown
        
        # Use DOCK type hint - critical for staying above fullscreen
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
        
        # Reserve space at top-left corner using strut (like a panel/dock)
        self.setup_strut()
        
        # Keep on top but don't force focus aggressively
        GLib.timeout_add(2000, self.ensure_on_top)  # Check every 2 seconds
        
        # Fade out after 3 seconds
        GLib.timeout_add(3000, self.start_fade_out)
        
        print("Overlay window created and shown at full opacity", flush=True)
    
    def setup_strut(self):
        """Set up strut to reserve space like a dock/panel"""
        try:
            # Get the GDK window
            gdk_window = self.get_window()
            if gdk_window:
                # Reserve 110x110 pixels at top-left corner
                # Format: [left, right, top, bottom, left_start_y, left_end_y, right_start_y, right_end_y, top_start_x, top_end_x, bottom_start_x, bottom_end_x]
                strut_partial = [0, 0, 110, 0, 0, 0, 0, 0, 0, 110, 0, 0]
                strut = [0, 0, 110, 0]  # Simple version: [left, right, top, bottom]
                
                # Set both properties for compatibility
                gdk_window.property_change("_NET_WM_STRUT_PARTIAL", "CARDINAL", 32, Gdk.PropMode.REPLACE, strut_partial)
                gdk_window.property_change("_NET_WM_STRUT", "CARDINAL", 32, Gdk.PropMode.REPLACE, strut)
                print("Strut properties set for dock-like behavior", flush=True)
        except Exception as e:
            print(f"Failed to set strut: {e}", flush=True)
    
    def ensure_on_top(self):
        """Gently ensure window stays on top without stealing focus"""
        self.set_keep_above(True)
        # Re-apply strut periodically to ensure it sticks
        self.setup_strut()
        return True  # Continue calling periodically
    
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
        self.fade_timer = GLib.timeout_add(200, self.fade_step_out)  # Slower fade steps
        return False
    
    def fade_step_out(self):
        """Gradually fade out"""
        self.fade_step += 1
        new_opacity = max(0.2, 1.0 - (self.fade_step * 0.15))  # Fade to 20% instead of 30%
        self.set_opacity(new_opacity)
        print(f"Fade step {self.fade_step}, opacity: {new_opacity:.2f}", flush=True)
        
        if new_opacity <= 0.2:
            print(f"Fade complete at opacity: {new_opacity:.2f}", flush=True)
            return False  # Stop the animation
        
        return True  # Continue fading
    
    def on_mouse_enter(self, widget, event):
        """Show full opacity on hover"""
        self.set_opacity(1.0)
        print("Mouse enter - full opacity", flush=True)
        return False
    
    def on_mouse_leave(self, widget, event):
        """Return to low opacity when mouse leaves"""
        self.set_opacity(0.2)  # Match the faded opacity
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
    
    // Launch Stremio using spawn (non-blocking)
    const command = 'DISPLAY=:0 stremio';
    console.log('Executing:', command);
    
    // Use spawn instead of exec for GUI applications
    const stremioProcess = spawn('stremio', [], {
      env: { ...process.env, DISPLAY: ':0' },
      detached: true,
      stdio: 'ignore'
    });
    
    stremioProcess.on('error', (error) => {
      console.log('Stremio spawn error:', error.message);
      // Try flatpak version
      console.log('Trying flatpak version...');
      const flatpakProcess = spawn('flatpak', ['run', 'com.stremio.Stremio'], {
        env: { ...process.env, DISPLAY: ':0' },
        detached: true,
        stdio: 'ignore'
      });
      
      flatpakProcess.on('error', (flatpakError) => {
        console.error('Flatpak Stremio also failed:', flatpakError.message);
        hideCornerOverlay();
      });
      
      flatpakProcess.on('spawn', () => {
        console.log('Flatpak Stremio spawned successfully');
        attemptFullscreen();
      });
    });
    
    stremioProcess.on('spawn', () => {
      console.log('Regular Stremio spawned successfully');
      attemptFullscreen();
    });
    
  }, 1000);
  
  function attemptFullscreen() {
    console.log('=== ATTEMPTING FULLSCREEN ===');
    
    // Wait for Stremio to fully load, then try to make it fullscreen
    setTimeout(() => {
      console.log(`Checking stremioLaunched flag: ${stremioLaunched}`);
      
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
        
        console.log('xdotool found, searching for Stremio window...');
        
        // First, let's see what windows are available
        exec('xdotool search --onlyvisible --name "Stremio"', (searchError, searchOutput) => {
          if (searchError || !searchOutput.trim()) {
            console.log('Could not find Stremio window by name, trying class...');
            
            exec('xdotool search --onlyvisible --class "stremio"', (classError, classOutput) => {
              if (classError || !classOutput.trim()) {
                console.log('Could not find Stremio by class either. Listing all windows...');
                exec('xdotool search --onlyvisible ""', (allError, allOutput) => {
                  console.log('All visible windows:', allOutput);
                  
                  // Also try to get window names to help debug
                  exec('wmctrl -l', (wmError, wmOutput) => {
                    console.log('wmctrl window list:', wmOutput);
                  });
                });
                return;
              }
              
              console.log('Found Stremio window by class:', classOutput);
              sendF11ToWindow(classOutput.trim().split('\n')[0]); // Take first window ID
            });
            return;
          }
          
          console.log('Found Stremio window by name:', searchOutput);
          sendF11ToWindow(searchOutput.trim().split('\n')[0]); // Take first window ID
        });
      });
    }, 2000); // Reduced to 2 seconds - most apps load by then
  }
  
  function sendF11ToWindow(windowId) {
    if (!windowId) {
      console.log('No window ID provided');
      return;
    }
    
    console.log(`Sending F11 to window ID: ${windowId}`);
    
    // First activate the window, then send F11
    exec(`xdotool windowactivate ${windowId}`, (activateError) => {
      if (activateError) {
        console.log('Could not activate window:', activateError.message);
        return;
      }
      
      console.log('Window activated, sending F11...');
      exec(`xdotool key --window ${windowId} F11`, (f11Error) => {
        if (f11Error) {
          console.log('F11 failed, trying "f" key...');
          exec(`xdotool key --window ${windowId} f`, (fError) => {
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
