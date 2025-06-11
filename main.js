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
import time

class SlidingDock(Gtk.Window):
    def __init__(self):
        super().__init__()
        
        print("Creating sliding dock...", flush=True)
        
        # CRITICAL: Window setup for staying above fullscreen apps
        self.set_title("Sliding Close Dock")
        self.set_default_size(80, 80)
        self.set_resizable(False)
        self.set_decorated(False)
        self.set_skip_taskbar_hint(True)
        self.set_skip_pager_hint(True)
        self.set_accept_focus(False)
        self.set_focus_on_map(False)
        self.set_keep_above(True)  # This is crucial!
        
        # Use DOCK type hint for proper layering above fullscreen apps
        self.set_type_hint(Gdk.WindowTypeHint.DOCK)
        
        # Position setup
        self.hidden_x = -70
        self.hidden_y = 10
        self.visible_x = 10
        self.visible_y = 10
        
        self.move(self.hidden_x, self.hidden_y)
        
        # State tracking
        self.is_visible = False
        self.slide_timer = None
        self.mouse_inside = False
        
        # Enable transparency and compositing
        screen = self.get_screen()
        visual = screen.get_rgba_visual()
        if visual and screen.is_composited():
            self.set_visual(visual)
            self.set_app_paintable(True)
            print("Transparency enabled", flush=True)
        else:
            print("No compositor detected - transparency may not work", flush=True)
        
        # Create close button
        self.button = Gtk.Button()
        self.button.set_label("✕")
        self.button.connect("clicked", self.on_close_clicked)
        
        # Enhanced styling
        css = b"""
        window {
            background: transparent;
            border: none;
        }
        button {
            background: linear-gradient(45deg, rgba(220, 20, 20, 0.95), rgba(180, 0, 0, 0.95));
            color: white;
            font-size: 28px;
            font-weight: bold;
            font-family: "DejaVu Sans", sans-serif;
            border: 3px solid rgba(255, 255, 255, 0.8);
            border-radius: 20px;
            min-width: 70px;
            min-height: 70px;
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5);
            transition: all 0.2s ease;
        }
        button:hover {
            background: linear-gradient(45deg, rgba(255, 0, 0, 1.0), rgba(220, 20, 20, 1.0));
            border: 3px solid rgba(255, 255, 0, 1.0);
            box-shadow: 0 6px 20px rgba(255, 0, 0, 0.4);
            transform: scale(1.05);
        }
        button:active {
            transform: scale(0.95);
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.8);
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
        
        # Enable mouse events
        self.add_events(Gdk.EventMask.ENTER_NOTIFY_MASK | 
                       Gdk.EventMask.LEAVE_NOTIFY_MASK |
                       Gdk.EventMask.POINTER_MOTION_MASK)
        
        self.show_all()
        
        # CRITICAL: Force window to be on top after showing
        GLib.timeout_add(100, self.force_on_top)
        
        # Set up corner monitoring
        self.setup_corner_monitoring()
        
        print("Sliding dock created", flush=True)
    
    def force_on_top(self):
        """Force window to stay on top using X11 properties"""
        try:
            # Get the GDK window
            gdk_window = self.get_window()
            if gdk_window:
                # Get X11 window ID
                if hasattr(gdk_window, 'get_xid'):
                    xid = gdk_window.get_xid()
                    
                    # Use wmctrl to force window above fullscreen apps
                    subprocess.run(['wmctrl', '-i', '-r', str(xid), '-b', 'add,above'], 
                                 capture_output=True, timeout=1)
                    
                    # Also try xdotool approach
                    subprocess.run(['xdotool', 'windowraise', str(xid)], 
                                 capture_output=True, timeout=1)
                    
                    print(f"Forced window {xid} to top", flush=True)
        except Exception as e:
            print(f"Could not force window on top: {e}", flush=True)
        
        # Continue forcing it to top periodically
        return True
    
    def setup_corner_monitoring(self):
        """Monitor mouse position for corner detection"""
        self.corner_check_timer = GLib.timeout_add(50, self.check_corner_hover)
    
    def check_corner_hover(self):
        """Check if mouse is in top-left corner"""
        try:
            display = Gdk.Display.get_default()
            seat = display.get_default_seat()
            pointer = seat.get_pointer()
            screen, x, y, mask = pointer.get_position()
            
            # Larger corner trigger area for easier activation
            corner_size = 80
            if x <= corner_size and y <= corner_size:
                if not self.is_visible:
                    self.slide_in()
            else:
                # Check if mouse is over the dock itself
                if self.is_visible and not self.mouse_inside:
                    dock_x, dock_y = self.get_position()
                    dock_w, dock_h = self.get_size()
                    
                    # Add some margin for easier mouse handling
                    margin = 20
                    if not (dock_x - margin <= x <= dock_x + dock_w + margin and 
                           dock_y - margin <= y <= dock_y + dock_h + margin):
                        self.slide_out()
        
        except Exception as e:
            print(f"Corner check error: {e}", flush=True)
        
        return True
    
    def slide_in(self):
        """Slide dock into view with smooth animation"""
        if self.slide_timer:
            GLib.source_remove(self.slide_timer)
        
        print("Sliding dock in...", flush=True)
        self.is_visible = True
        self.animate_to_position(self.visible_x, self.visible_y)
        
        # Force window on top when sliding in
        GLib.timeout_add(10, self.force_on_top_once)
    
    def slide_out(self):
        """Slide dock out of view with smooth animation"""
        if self.slide_timer:
            GLib.source_remove(self.slide_timer)
        
        print("Sliding dock out...", flush=True)
        self.is_visible = False
        self.animate_to_position(self.hidden_x, self.hidden_y)
    
    def force_on_top_once(self):
        """Force window on top once"""
        self.force_on_top()
        return False  # Don't repeat
    
    def animate_to_position(self, target_x, target_y):
        """Smooth animation to target position"""
        current_x, current_y = self.get_position()
        
        # More animation steps for smoother movement
        steps = 15
        step_x = (target_x - current_x) / steps
        step_y = (target_y - current_y) / steps
        
        self.animation_step = 0
        self.animation_start_x = current_x
        self.animation_start_y = current_y
        self.animation_target_x = target_x
        self.animation_target_y = target_y
        self.animation_step_x = step_x
        self.animation_step_y = step_y
        
        self.slide_timer = GLib.timeout_add(16, self.animation_tick)  # ~60fps
    
    def animation_tick(self):
        """Animation frame update with easing"""
        self.animation_step += 1
        
        if self.animation_step <= 15:
            # Ease-out animation
            progress = self.animation_step / 15.0
            eased_progress = 1 - (1 - progress) ** 3  # Cubic ease-out
            
            new_x = int(self.animation_start_x + (self.animation_target_x - self.animation_start_x) * eased_progress)
            new_y = int(self.animation_start_y + (self.animation_target_y - self.animation_start_y) * eased_progress)
            
            self.move(new_x, new_y)
            return True
        else:
            # Ensure final position is exact
            self.move(int(self.animation_target_x), int(self.animation_target_y))
            self.slide_timer = None
            return False
    
    def on_draw(self, widget, cr):
        """Render transparent background with subtle shadow"""
        # Clear background
        cr.set_source_rgba(0, 0, 0, 0)
        cr.set_operator(1)  # CAIRO_OPERATOR_SOURCE
        cr.paint()
        
        # Optional: Add a subtle drop shadow behind the button
        if self.is_visible:
            allocation = self.get_allocation()
            cr.set_source_rgba(0, 0, 0, 0.3)
            cr.set_operator(0)  # CAIRO_OPERATOR_OVER
            cr.rectangle(2, 2, allocation.width, allocation.height)
            cr.fill()
        
        return False
    
    def on_mouse_enter(self, widget, event):
        """Mouse entered dock area"""
        print("Mouse entered dock", flush=True)
        self.mouse_inside = True
        return False
    
    def on_mouse_leave(self, widget, event):
        """Mouse left dock area"""
        print("Mouse left dock", flush=True)
        self.mouse_inside = False
        return False
    
    def on_close_clicked(self, button):
        print("=== CLOSE BUTTON CLICKED ===", flush=True)
        print("Closing Firefox and Stremio...", flush=True)
        
        # Kill applications with more comprehensive cleanup
        subprocess.run(['pkill', '-f', 'firefox.*kiosk'], capture_output=True)
        subprocess.run(['pkill', '-f', 'firefox'], capture_output=True)
        subprocess.run(['pkill', '-f', 'stremio'], capture_output=True)
        subprocess.run(['pkill', '-f', 'flatpak.*stremio'], capture_output=True)
        
        print("Applications closed, quitting dock...", flush=True)
        Gtk.main_quit()

def signal_handler(sig, frame):
    print("Signal received, quitting...", flush=True)
    Gtk.main_quit()

# Handle signals
signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

print("Starting enhanced sliding dock...", flush=True)

# Ensure we have the required tools
required_tools = ['wmctrl', 'xdotool']
missing_tools = []

for tool in required_tools:
    try:
        subprocess.run(['which', tool], capture_output=True, check=True)
    except subprocess.CalledProcessError:
        missing_tools.append(tool)

if missing_tools:
    print(f"WARNING: Missing tools: {missing_tools}", flush=True)
    print("Install with: pacman -S wmctrl xorg-xdotool", flush=True)

try:
    dock = SlidingDock()
    Gtk.main()
    print("Enhanced sliding dock ended", flush=True)
except Exception as e:
    print(f"Error: {e}", flush=True)
    sys.exit(1)
`;

  fs.writeFileSync('/tmp/enhanced_overlay.py', overlayScript);
  exec('chmod +x /tmp/enhanced_overlay.py');
}

function showCornerOverlay() {
  if (overlayProcess) {
    console.log('Killing existing overlay process...');
    overlayProcess.kill();
  }
  
  console.log('=== STARTING ENHANCED OVERLAY ===');
  createOverlayScript();
  
  // Start the enhanced GTK overlay process
  overlayProcess = spawn('python3', ['/tmp/enhanced_overlay.py'], {
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
    console.error('Failed to start enhanced overlay:', error);
  });
  
  overlayProcess.on('exit', (code) => {
    console.log('=== ENHANCED OVERLAY EXITED ===');
    console.log('Exit code:', code);
    overlayProcess = null;
    
    firefoxLaunched = false;
    stremioLaunched = false;
    
    setTimeout(() => {
      console.log('=== FOCUSING MAIN WINDOW ===');
      if (mainWindow) {
        mainWindow.focus();
        mainWindow.show();
      }
    }, 300);
  });
}

function hideCornerOverlay() {
  if (overlayProcess) {
    overlayProcess.kill();
    overlayProcess = null;
  }
  
  exec('pkill -f enhanced_overlay.py');
  firefoxLaunched = false;
  stremioLaunched = false;
}

function launchFirefoxInKioskMode(url) {
  console.log(`=== LAUNCHING FIREFOX KIOSK ===`);
  firefoxLaunched = true;
  
  showCornerOverlay();
  
  setTimeout(() => {
    if (!firefoxLaunched) return;
    
    const firefoxCommand = `DISPLAY=:0 firefox --new-window --kiosk "${url}"`;
    console.log('Executing:', firefoxCommand);
    
    exec(firefoxCommand, (error) => {
      if (!firefoxLaunched) return;
      
      if (error) {
        console.log('Trying firefox-esr...');
        const esrCommand = `DISPLAY=:0 firefox-esr --new-window --kiosk "${url}"`;
        exec(esrCommand, (esrError) => {
          if (!firefoxLaunched) return;
          if (esrError) {
            console.error('Firefox not available');
            hideCornerOverlay();
            shell.openExternal(url);
          }
        });
      }
    });
  }, 1500);
}

function launchStremioFullscreen() {
  console.log(`=== LAUNCHING STREMIO ===`);
  stremioLaunched = true;
  
  showCornerOverlay();
  
  setTimeout(() => {
    if (!stremioLaunched) return;
    
    const stremioProcess = spawn('stremio', [], {
      env: { ...process.env, DISPLAY: ':0' },
      detached: true,
      stdio: 'ignore'
    });
    
    stremioProcess.on('error', (error) => {
      console.log('Trying flatpak Stremio...');
      const flatpakProcess = spawn('flatpak', ['run', 'com.stremio.Stremio'], {
        env: { ...process.env, DISPLAY: ':0' },
        detached: true,
        stdio: 'ignore'
      });
      
      flatpakProcess.on('error', (flatpakError) => {
        console.error('All Stremio attempts failed');
        hideCornerOverlay();
      });
      
      flatpakProcess.on('spawn', () => {
        console.log('Flatpak Stremio launched');
        attemptFullscreen();
      });
    });
    
    stremioProcess.on('spawn', () => {
      console.log('Regular Stremio launched');
      attemptFullscreen();
    });
  }, 1500);
  
  function attemptFullscreen() {
    setTimeout(() => {
      if (!stremioLaunched) return;
      
      exec('xdotool search --onlyvisible --name "Stremio"', (error, output) => {
        if (!error && output.trim()) {
          const windowId = output.trim().split('\n')[0];
          exec(`xdotool windowactivate ${windowId} && sleep 0.5 && xdotool key --window ${windowId} F11`);
        }
      });
    }, 3000);
  }
}

app.whenReady().then(createWindow);

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
