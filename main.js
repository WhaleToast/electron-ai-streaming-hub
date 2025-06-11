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
  // Create a sliding dock overlay script
  const overlayScript = `#!/usr/bin/env python3
import gi
gi.require_version('Gtk', '3.0')
gi.require_version('Gdk', '3.0')
from gi.repository import Gtk, Gdk, GLib
import subprocess
import sys
import signal

class SlidingDock(Gtk.Window):
    def __init__(self):
        super().__init__()
        
        print("Creating sliding dock...", flush=True)
        
        # Window setup - sliding dock
        self.set_title("Sliding Close Dock")
        self.set_default_size(80, 80)
        self.set_resizable(False)
        self.set_decorated(False)
        self.set_skip_taskbar_hint(True)
        self.set_skip_pager_hint(True)
        self.set_accept_focus(False)
        self.set_focus_on_map(False)
        
        # Use DOCK type hint for proper layering
        self.set_type_hint(Gdk.WindowTypeHint.DOCK)
        
        # Start hidden off-screen at top-left corner
        self.hidden_x = -70  # Most of the window off-screen
        self.hidden_y = 0
        self.visible_x = 0   # Fully visible position
        self.visible_y = 0
        
        self.move(self.hidden_x, self.hidden_y)
        
        # State tracking
        self.is_visible = False
        self.slide_timer = None
        
        # Make window transparent
        screen = self.get_screen()
        visual = screen.get_rgba_visual()
        if visual and screen.is_composited():
            self.set_visual(visual)
        self.set_app_paintable(True)
        
        # Create close button
        self.button = Gtk.Button()
        self.button.set_label("✕")
        self.button.connect("clicked", self.on_close_clicked)
        
        # Style the button
        css = b"""
        window {
            background: transparent;
        }
        button {
            background: rgba(220, 20, 20, 0.95);
            color: white;
            font-size: 24px;
            font-weight: bold;
            border: 2px solid white;
            border-radius: 15px;
            min-width: 70px;
            min-height: 70px;
        }
        button:hover {
            background: rgba(255, 0, 0, 1.0);
            border: 2px solid yellow;
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
        
        # Set up mouse monitoring for corner detection
        self.setup_corner_monitoring()
        
        self.show_all()
        print("Sliding dock created and hidden", flush=True)
    
    def setup_corner_monitoring(self):
        """Monitor mouse position for corner detection"""
        self.corner_check_timer = GLib.timeout_add(100, self.check_corner_hover)
    
    def check_corner_hover(self):
        """Check if mouse is in top-left corner"""
        try:
            display = Gdk.Display.get_default()
            seat = display.get_default_seat()
            pointer = seat.get_pointer()
            screen, x, y, mask = pointer.get_position()
            
            # Top-left corner trigger area (50x50 pixels)
            if x <= 50 and y <= 50:
                if not self.is_visible:
                    self.slide_in()
            else:
                # Only slide out if mouse is not over the dock itself
                if self.is_visible and not self.is_mouse_over_dock():
                    self.slide_out()
        
        except Exception as e:
            print(f"Corner check error: {e}", flush=True)
        
        return True  # Continue monitoring
    
    def is_mouse_over_dock(self):
        """Check if mouse is over the dock window"""
        try:
            dock_window = self.get_window()
            if dock_window:
                screen, x, y, mask = dock_window.get_display().get_default_seat().get_pointer().get_position()
                dock_x, dock_y = self.get_position()
                dock_w, dock_h = self.get_size()
                
                return (dock_x <= x <= dock_x + dock_w and 
                        dock_y <= y <= dock_y + dock_h)
        except:
            pass
        return False
    
    def slide_in(self):
        """Slide dock into view"""
        if self.slide_timer:
            GLib.source_remove(self.slide_timer)
        
        print("Sliding dock in...", flush=True)
        self.is_visible = True
        self.animate_to_position(self.visible_x, self.visible_y)
    
    def slide_out(self):
        """Slide dock out of view"""
        if self.slide_timer:
            GLib.source_remove(self.slide_timer)
        
        print("Sliding dock out...", flush=True)
        self.is_visible = False
        self.animate_to_position(self.hidden_x, self.hidden_y)
    
    def animate_to_position(self, target_x, target_y):
        """Smooth animation to target position"""
        current_x, current_y = self.get_position()
        
        # Calculate animation steps
        steps = 10
        step_x = (target_x - current_x) / steps
        step_y = (target_y - current_y) / steps
        
        self.animation_step = 0
        self.animation_start_x = current_x
        self.animation_start_y = current_y
        self.animation_target_x = target_x
        self.animation_target_y = target_y
        self.animation_step_x = step_x
        self.animation_step_y = step_y
        
        self.slide_timer = GLib.timeout_add(20, self.animation_tick)
    
    def animation_tick(self):
        """Animation frame update"""
        self.animation_step += 1
        
        if self.animation_step <= 10:
            new_x = int(self.animation_start_x + (self.animation_step_x * self.animation_step))
            new_y = int(self.animation_start_y + (self.animation_step_y * self.animation_step))
            self.move(new_x, new_y)
            return True  # Continue animation
        else:
            # Ensure final position is exact
            self.move(int(self.animation_target_x), int(self.animation_target_y))
            self.slide_timer = None
            return False  # Stop animation
    
    def on_draw(self, widget, cr):
        """Make window background transparent"""
        cr.set_source_rgba(0, 0, 0, 0)
        cr.set_operator(1)  # CAIRO_OPERATOR_SOURCE
        cr.paint()
        return False
    
    def on_mouse_enter(self, widget, event):
        """Mouse entered dock area"""
        print("Mouse entered dock", flush=True)
        return False
    
    def on_mouse_leave(self, widget, event):
        """Mouse left dock area"""
        print("Mouse left dock", flush=True)
        return False
    
    def on_close_clicked(self, button):
        print("=== CLOSE BUTTON CLICKED ===", flush=True)
        print("Closing Firefox and Stremio...", flush=True)
        
        # Kill applications
        subprocess.run(['pkill', '-f', 'firefox.*kiosk'], capture_output=True)
        subprocess.run(['pkill', 'firefox'], capture_output=True)
        subprocess.run(['pkill', 'stremio'], capture_output=True)
        
        print("Applications closed, quitting dock...", flush=True)
        Gtk.main_quit()

def signal_handler(sig, frame):
    print("Signal received, quitting...", flush=True)
    Gtk.main_quit()

# Handle signals
signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

print("Starting sliding dock application...", flush=True)

# Create and run sliding dock
try:
    dock = SlidingDock()
    Gtk.main()
    print("Sliding dock ended", flush=True)
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
