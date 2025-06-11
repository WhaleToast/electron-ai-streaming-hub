const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let overlayProcess = null;
let firefoxLaunched = false;
let stremioLaunched = false;

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
  const overlayScript = `#!/usr/bin/env python3
import gi
gi.require_version('Gtk', '3.0')
gi.require_version('Gdk', '3.0')
from gi.repository import Gtk, Gdk, GLib
import subprocess
import sys
import signal
import os

class SlidingDock(Gtk.Window):
    def __init__(self):
        super().__init__()
        
        print("Creating robust sliding dock...", flush=True)
        
        # Window setup
        self.set_title("KioskCloseDock")
        self.set_default_size(70, 70)
        self.set_resizable(False)
        self.set_decorated(False)
        self.set_skip_taskbar_hint(True)
        self.set_skip_pager_hint(True)
        self.set_accept_focus(False)
        self.set_keep_above(True)
        
        # Use DOCK type hint for better window management
        self.set_type_hint(Gdk.WindowTypeHint.DOCK)
        
        # Position variables
        self.hidden_x = -50
        self.hidden_y = 20
        self.visible_x = 20
        self.visible_y = 20
        
        # State tracking
        self.is_visible = False
        self.mouse_inside = False
        self.slide_timer = None
        
        # Move to hidden position initially
        self.move(self.hidden_x, self.hidden_y)
        
        # Create close button
        self.button = Gtk.Button()
        self.button.set_label("✕")
        self.button.connect("clicked", self.on_close_clicked)
        
        # Simple, reliable CSS
        css_data = """
        window {
            background-color: rgba(50, 50, 50, 0.9);
            border: 1px solid #333;
        }
        button {
            background-color: #cc0000;
            color: white;
            font-size: 20px;
            font-weight: bold;
            border: 2px solid white;
            border-radius: 10px;
            min-width: 50px;
            min-height: 50px;
        }
        button:hover {
            background-color: #ff0000;
            border-color: yellow;
        }
        """
        
        # Apply CSS safely
        try:
            css_provider = Gtk.CssProvider()
            css_provider.load_from_data(css_data.encode())
            context = Gtk.StyleContext()
            screen = Gdk.Screen.get_default()
            context.add_provider_for_screen(screen, css_provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
            print("CSS applied successfully", flush=True)
        except Exception as e:
            print(f"CSS failed, using default styling: {e}", flush=True)
        
        self.add(self.button)
        
        # Connect mouse events
        self.connect("enter-notify-event", self.on_mouse_enter)
        self.connect("leave-notify-event", self.on_mouse_leave)
        self.add_events(Gdk.EventMask.ENTER_NOTIFY_MASK | Gdk.EventMask.LEAVE_NOTIFY_MASK)
        
        self.show_all()
        
        # Start corner monitoring
        self.setup_corner_monitoring()
        
        print("Sliding dock ready", flush=True)
    
    def setup_corner_monitoring(self):
        """Set up mouse position monitoring using xdotool"""
        self.corner_timer = GLib.timeout_add(200, self.check_corner_with_xdotool)
    
    def check_corner_with_xdotool(self):
        """Use xdotool to get mouse position - more reliable"""
        try:
            # Use xdotool to get mouse position
            result = subprocess.run(['xdotool', 'getmouselocation'], 
                                  capture_output=True, text=True, timeout=1)
            
            if result.returncode == 0:
                # Parse output: "x:123 y:456 screen:0 window:789"
                output = result.stdout.strip()
                parts = output.split()
                
                x = int(parts[0].split(':')[1])
                y = int(parts[1].split(':')[1])
                
                # Check corner area (larger for easier triggering)
                corner_size = 80
                in_corner = x <= corner_size and y <= corner_size
                
                if in_corner and not self.is_visible:
                    print(f"Mouse in corner: {x},{y} - showing dock", flush=True)
                    self.slide_in()
                elif not in_corner and self.is_visible and not self.mouse_inside:
                    # Check if mouse is near dock
                    dock_x, dock_y = self.get_position()
                    dock_w, dock_h = self.get_size()
                    
                    margin = 50
                    near_dock = (dock_x - margin <= x <= dock_x + dock_w + margin and
                               dock_y - margin <= y <= dock_y + dock_h + margin)
                    
                    if not near_dock:
                        print(f"Mouse away from dock: {x},{y} - hiding", flush=True)
                        self.slide_out()
                        
        except Exception as e:
            print(f"xdotool mouse check failed: {e}", flush=True)
            # Fallback to GDK method if xdotool fails
            try:
                display = Gdk.Display.get_default()
                seat = display.get_default_seat()
                pointer = seat.get_pointer()
                result = pointer.get_position()
                
                if len(result) >= 3:
                    screen, x, y = result[0], result[1], result[2]
                    
                    corner_size = 80
                    if x <= corner_size and y <= corner_size and not self.is_visible:
                        self.slide_in()
                    elif x > corner_size + 100 or y > corner_size + 100:
                        if self.is_visible and not self.mouse_inside:
                            self.slide_out()
            except Exception as gdk_error:
                print(f"Both mouse detection methods failed: {gdk_error}", flush=True)
        
        return True  # Continue monitoring
    
    def slide_in(self):
        """Show the dock"""
        if self.slide_timer:
            GLib.source_remove(self.slide_timer)
        
        self.is_visible = True
        print("Sliding in...", flush=True)
        
        # Simple immediate move for reliability
        self.move(self.visible_x, self.visible_y)
        
        # Try to ensure window is on top
        try:
            subprocess.run(['xdotool', 'windowraise', str(self.get_window().get_xid())], 
                         timeout=1, capture_output=True)
        except:
            pass
    
    def slide_out(self):
        """Hide the dock"""
        if self.slide_timer:
            GLib.source_remove(self.slide_timer)
        
        self.is_visible = False
        print("Sliding out...", flush=True)
        
        # Simple immediate move for reliability
        self.move(self.hidden_x, self.hidden_y)
    
    def on_mouse_enter(self, widget, event):
        """Mouse entered dock"""
        self.mouse_inside = True
        print("Mouse entered dock", flush=True)
        return False
    
    def on_mouse_leave(self, widget, event):
        """Mouse left dock"""
        self.mouse_inside = False
        print("Mouse left dock", flush=True)
        return False
    
    def on_close_clicked(self, button):
        """Close button was clicked"""
        print("=== CLOSE BUTTON CLICKED ===", flush=True)
        
        # Kill Firefox processes
        firefox_commands = [
            ['pkill', '-f', 'firefox'],
            ['killall', 'firefox'],
            ['killall', 'firefox-esr']
        ]
        
        for cmd in firefox_commands:
            try:
                result = subprocess.run(cmd, timeout=3, capture_output=True)
                print(f"Executed {' '.join(cmd)}: return code {result.returncode}", flush=True)
            except Exception as e:
                print(f"Failed to execute {' '.join(cmd)}: {e}", flush=True)
        
        # Kill Stremio processes
        stremio_commands = [
            ['pkill', '-f', 'stremio'],
            ['killall', 'stremio'],
            ['pkill', '-f', 'Stremio']
        ]
        
        for cmd in stremio_commands:
            try:
                result = subprocess.run(cmd, timeout=3, capture_output=True)
                print(f"Executed {' '.join(cmd)}: return code {result.returncode}", flush=True)
            except Exception as e:
                print(f"Failed to execute {' '.join(cmd)}: {e}", flush=True)
        
        # Also try to close flatpak versions
        try:
            subprocess.run(['flatpak', 'kill', 'com.stremio.Stremio'], timeout=3, capture_output=True)
            print("Attempted to kill flatpak Stremio", flush=True)
        except:
            pass
        
        print("All termination attempts completed", flush=True)
        
        # Wait a moment then quit
        GLib.timeout_add(1000, lambda: Gtk.main_quit())

def signal_handler(sig, frame):
    print("Signal received, quitting...", flush=True)
    Gtk.main_quit()

# Set up signal handlers
signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

print("Starting robust sliding dock...", flush=True)

# Check for xdotool
try:
    subprocess.run(['xdotool', 'version'], capture_output=True, check=True, timeout=2)
    print("xdotool available", flush=True)
except:
    print("WARNING: xdotool not available - mouse detection may be unreliable", flush=True)

try:
    dock = SlidingDock()
    Gtk.main()
    print("Dock ended normally", flush=True)
except Exception as e:
    print(f"Dock error: {e}", flush=True)
    import traceback
    traceback.print_exc()
    sys.exit(1)
`;

  fs.writeFileSync('/tmp/robust_overlay.py', overlayScript);
  exec('chmod +x /tmp/robust_overlay.py');
}

function showCornerOverlay() {
  if (overlayProcess) {
    console.log('Terminating existing overlay...');
    overlayProcess.kill('SIGTERM');
    overlayProcess = null;
  }
  
  console.log('=== STARTING ROBUST OVERLAY ===');
  createOverlayScript();
  
  overlayProcess = spawn('python3', ['/tmp/robust_overlay.py'], {
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
    console.error('Failed to start overlay:', error);
  });
  
  overlayProcess.on('exit', (code, signal) => {
    console.log(`=== OVERLAY EXITED: code=${code}, signal=${signal} ===`);
    overlayProcess = null;
    
    firefoxLaunched = false;
    stremioLaunched = false;
    
    // Return focus to main window
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.focus();
        mainWindow.show();
        console.log('Main window focused');
      }
    }, 500);
  });
}

function hideCornerOverlay() {
  if (overlayProcess) {
    console.log('Hiding overlay...');
    overlayProcess.kill('SIGTERM');
    overlayProcess = null;
  }
  
  // Clean up any remaining overlay processes
  exec('pkill -f robust_overlay.py', (error) => {
    if (error) {
      console.log('No overlay processes to clean up');
    }
  });
  
  firefoxLaunched = false;
  stremioLaunched = false;
}

function launchFirefoxInKioskMode(url) {
  console.log(`=== LAUNCHING FIREFOX KIOSK: ${url} ===`);
  firefoxLaunched = true;
  
  // Start overlay first
  showCornerOverlay();
  
  // Launch Firefox after delay
  setTimeout(() => {
    if (!firefoxLaunched) {
      console.log('Firefox launch cancelled');
      return;
    }
    
    console.log('Starting Firefox...');
    
    // Try firefox first
    const firefoxCmd = spawn('firefox', ['--new-window', '--kiosk', url], {
      env: { ...process.env, DISPLAY: ':0' },
      detached: true,
      stdio: 'ignore'
    });
    
    firefoxCmd.on('error', (error) => {
      console.log('Firefox failed, trying firefox-esr...');
      
      // Try firefox-esr as fallback
      const esrCmd = spawn('firefox-esr', ['--new-window', '--kiosk', url], {
        env: { ...process.env, DISPLAY: ':0' },
        detached: true,
        stdio: 'ignore'
      });
      
      esrCmd.on('error', (esrError) => {
        console.error('Both Firefox attempts failed');
        hideCornerOverlay();
        shell.openExternal(url);
      });
      
      esrCmd.on('spawn', () => {
        console.log('Firefox ESR launched successfully');
      });
    });
    
    firefoxCmd.on('spawn', () => {
      console.log('Firefox launched successfully');
    });
    
  }, 2000);
}

function launchStremioFullscreen() {
  console.log(`=== LAUNCHING STREMIO ===`);
  stremioLaunched = true;
  
  // Start overlay first
  showCornerOverlay();
  
  // Launch Stremio after delay
  setTimeout(() => {
    if (!stremioLaunched) {
      console.log('Stremio launch cancelled');
      return;
    }
    
    console.log('Starting Stremio...');
    
    // Try regular stremio
    const stremioCmd = spawn('stremio', [], {
      env: { ...process.env, DISPLAY: ':0' },
      detached: true,
      stdio: 'ignore'
    });
    
    stremioCmd.on('error', (error) => {
      console.log('Regular Stremio failed, trying flatpak...');
      
      // Try flatpak version
      const flatpakCmd = spawn('flatpak', ['run', 'com.stremio.Stremio'], {
        env: { ...process.env, DISPLAY: ':0' },
        detached: true,
        stdio: 'ignore'
      });
      
      flatpakCmd.on('error', (flatpakError) => {
        console.error('Both Stremio attempts failed');
        hideCornerOverlay();
      });
      
      flatpakCmd.on('spawn', () => {
        console.log('Flatpak Stremio launched');
        attemptFullscreen();
      });
    });
    
    stremioCmd.on('spawn', () => {
      console.log('Regular Stremio launched');
      attemptFullscreen();
    });
    
  }, 2000);
  
  function attemptFullscreen() {
    // Wait for Stremio to load, then try fullscreen
    setTimeout(() => {
      if (!stremioLaunched) return;
      
      console.log('Attempting to make Stremio fullscreen...');
      
      exec('xdotool search --onlyvisible --name "Stremio"', (error, output) => {
        if (!error && output.trim()) {
          const windowId = output.trim().split('\n')[0];
          console.log(`Found Stremio window: ${windowId}`);
          
          // Activate window and send F11
          exec(`xdotool windowactivate ${windowId} && sleep 1 && xdotool key --window ${windowId} F11`, (f11Error) => {
            if (f11Error) {
              console.log('F11 failed, trying alternative...');
              exec(`xdotool key --window ${windowId} f`);
            } else {
              console.log('F11 sent successfully');
            }
          });
        } else {
          console.log('Could not find Stremio window for fullscreen');
        }
      });
    }, 4000);
  }
}

// Electron app events
app.whenReady().then(createWindow);

ipcMain.on('launch', (event, data) => {
  console.log('Launch request:', data);
  
  if (data.type === 'url') {
    launchFirefoxInKioskMode(data.target);
  } else if (data.type === 'app') {
    if (data.target === 'stremio') {
      launchStremioFullscreen();
    } else {
      // Launch other apps normally
      const appCmd = spawn(data.target, [], {
        env: { ...process.env, DISPLAY: ':0' },
        detached: true,
        stdio: 'ignore'
      });
      
      appCmd.on('error', (error) => {
        console.error(`Failed to launch ${data.target}:`, error);
      });
    }
  }
});

app.on('before-quit', () => {
  console.log('App quitting - cleaning up...');
  firefoxLaunched = false;
  stremioLaunched = false;
  hideCornerOverlay();
});

app.on('window-all-closed', () => {
  firefoxLaunched = false;
  stremioLaunched = false;
  hideCornerOverlay();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
