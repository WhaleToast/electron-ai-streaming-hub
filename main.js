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
        
        print("Creating sliding dock...", flush=True)
        
        # Window setup for staying above fullscreen apps
        self.set_title("Sliding Close Dock")
        self.set_default_size(80, 80)
        self.set_resizable(False)
        self.set_decorated(False)
        self.set_skip_taskbar_hint(True)
        self.set_skip_pager_hint(True)
        self.set_accept_focus(False)
        self.set_focus_on_map(False)
        self.set_keep_above(True)
        
        # Use DOCK type hint
        self.set_type_hint(Gdk.WindowTypeHint.DOCK)
        
        # Position setup
        self.hidden_x = -60
        self.hidden_y = 10
        self.visible_x = 10
        self.visible_y = 10
        
        self.move(self.hidden_x, self.hidden_y)
        
        # State tracking
        self.is_visible = False
        self.slide_timer = None
        self.mouse_inside = False
        
        # Check for compositor
        screen = self.get_screen()
        visual = screen.get_rgba_visual()
        if visual and screen.is_composited():
            self.set_visual(visual)
            self.set_app_paintable(True)
            print("Compositor detected - transparency enabled", flush=True)
        else:
            print("No compositor - using solid background", flush=True)
        
        # Create close button
        self.button = Gtk.Button()
        self.button.set_label("✕")
        self.button.connect("clicked", self.on_close_clicked)
        
        # Simple CSS without transforms or unsupported properties
        css = b"""
        window {
            background: rgba(0, 0, 0, 0.1);
            border: none;
        }
        button {
            background: #dc1414;
            color: white;
            font-size: 24px;
            font-weight: bold;
            font-family: sans-serif;
            border: 2px solid white;
            border-radius: 15px;
            min-width: 60px;
            min-height: 60px;
        }
        button:hover {
            background: #ff0000;
            border: 2px solid yellow;
        }
        button:active {
            background: #aa0000;
        }
        """
        
        try:
            style_provider = Gtk.CssProvider()
            style_provider.load_from_data(css)
            Gtk.StyleContext.add_provider_for_screen(
                Gdk.Screen.get_default(),
                style_provider,
                Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
            )
            print("CSS loaded successfully", flush=True)
        except Exception as e:
            print(f"CSS loading failed: {e}", flush=True)
        
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
        
        # Try to force window on top
        GLib.timeout_add(200, self.force_on_top_initial)
        
        # Set up corner monitoring
        self.setup_corner_monitoring()
        
        print("Sliding dock created and ready", flush=True)
    
    def force_on_top_initial(self):
        """Initial attempt to force window on top"""
        try:
            gdk_window = self.get_window()
            if gdk_window and hasattr(gdk_window, 'get_xid'):
                xid = gdk_window.get_xid()
                
                # Try wmctrl first
                result = subprocess.run(['wmctrl', '-i', '-r', str(xid), '-b', 'add,above'], 
                                     capture_output=True, timeout=2)
                if result.returncode == 0:
                    print(f"wmctrl success for window {xid}", flush=True)
                
                # Try xdotool as backup
                subprocess.run(['xdotool', 'windowraise', str(xid)], 
                             capture_output=True, timeout=2)
                
        except Exception as e:
            print(f"Force on top failed: {e}", flush=True)
        
        # Continue monitoring and forcing periodically
        GLib.timeout_add(2000, self.periodic_force_top)
        return False
    
    def periodic_force_top(self):
        """Periodically ensure window stays on top"""
        try:
            gdk_window = self.get_window()
            if gdk_window and hasattr(gdk_window, 'get_xid'):
                xid = gdk_window.get_xid()
                subprocess.run(['xdotool', 'windowraise', str(xid)], 
                             capture_output=True, timeout=1)
        except:
            pass
        return True
    
    def setup_corner_monitoring(self):
        """Monitor mouse position for corner detection"""
        self.corner_check_timer = GLib.timeout_add(100, self.check_corner_hover)
    
    def check_corner_hover(self):
        """Check if mouse is in top-left corner"""
        try:
            display = Gdk.Display.get_default()
            if not display:
                return True
                
            seat = display.get_default_seat()
            if not seat:
                return True
                
            pointer = seat.get_pointer()
            if not pointer:
                return True
                
            screen, x, y, mask = pointer.get_position()
            
            # Corner trigger area
            corner_size = 60
            if x <= corner_size and y <= corner_size:
                if not self.is_visible:
                    self.slide_in()
            else:
                # Check if mouse is over the dock
                if self.is_visible and not self.mouse_inside:
                    dock_x, dock_y = self.get_position()
                    dock_w, dock_h = self.get_size()
                    
                    margin = 30
                    if not (dock_x - margin <= x <= dock_x + dock_w + margin and 
                           dock_y - margin <= y <= dock_y + dock_h + margin):
                        self.slide_out()
        
        except Exception as e:
            print(f"Corner check error: {e}", flush=True)
        
        return True
    
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
        
        steps = 12
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
        
        if self.animation_step <= 12:
            progress = self.animation_step / 12.0
            # Simple easing
            eased = progress * progress * (3.0 - 2.0 * progress)
            
            new_x = int(self.animation_start_x + (self.animation_target_x - self.animation_start_x) * eased)
            new_y = int(self.animation_start_y + (self.animation_target_y - self.animation_start_y) * eased)
            
            self.move(new_x, new_y)
            return True
        else:
            self.move(int(self.animation_target_x), int(self.animation_target_y))
            self.slide_timer = None
            return False
    
    def on_draw(self, widget, cr):
        """Custom drawing with transparency"""
        if self.get_screen().is_composited():
            # Transparent background
            cr.set_source_rgba(0, 0, 0, 0)
            cr.set_operator(1)  # CAIRO_OPERATOR_SOURCE
            cr.paint()
        else:
            # Solid background if no compositor
            cr.set_source_rgba(0.2, 0.2, 0.2, 0.8)
            cr.paint()
        
        return False
    
    def on_mouse_enter(self, widget, event):
        """Mouse entered dock area"""
        self.mouse_inside = True
        return False
    
    def on_mouse_leave(self, widget, event):
        """Mouse left dock area"""
        self.mouse_inside = False
        return False
    
    def on_close_clicked(self, button):
        print("=== CLOSE BUTTON CLICKED ===", flush=True)
        
        # Kill applications
        try:
            subprocess.run(['pkill', '-f', 'firefox.*kiosk'], timeout=3)
            subprocess.run(['pkill', '-f', 'firefox'], timeout=3)
            subprocess.run(['pkill', '-f', 'stremio'], timeout=3)
            subprocess.run(['pkill', '-f', 'flatpak.*stremio'], timeout=3)
            print("Applications terminated", flush=True)
        except Exception as e:
            print(f"Error closing apps: {e}", flush=True)
        
        Gtk.main_quit()

def signal_handler(sig, frame):
    print("Signal received, quitting...", flush=True)
    Gtk.main_quit()

signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

print("Starting fixed sliding dock...", flush=True)

# Check for required tools
tools_available = True
for tool in ['wmctrl', 'xdotool']:
    try:
        subprocess.run(['which', tool], capture_output=True, check=True, timeout=2)
        print(f"{tool} available", flush=True)
    except:
        print(f"WARNING: {tool} not available", flush=True)
        tools_available = False

if not tools_available:
    print("Some tools missing - window management may not work properly", flush=True)

try:
    dock = SlidingDock()
    print("Starting GTK main loop...", flush=True)
    Gtk.main()
    print("GTK main loop ended", flush=True)
except Exception as e:
    print(f"Error: {e}", flush=True)
    import traceback
    traceback.print_exc()
    sys.exit(1)
`;

  fs.writeFileSync('/tmp/fixed_overlay.py', overlayScript);
  exec('chmod +x /tmp/fixed_overlay.py');
}

function showCornerOverlay() {
  if (overlayProcess) {
    console.log('Killing existing overlay process...');
    overlayProcess.kill();
  }
  
  console.log('=== STARTING FIXED OVERLAY ===');
  createOverlayScript();
  
  overlayProcess = spawn('python3', ['/tmp/fixed_overlay.py'], {
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
  
  overlayProcess.on('exit', (code) => {
    console.log('=== OVERLAY EXITED ===');
    console.log('Exit code:', code);
    overlayProcess = null;
    
    firefoxLaunched = false;
    stremioLaunched = false;
    
    setTimeout(() => {
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
  
  exec('pkill -f fixed_overlay.py');
  firefoxLaunched = false;
  stremioLaunched = false;
}

function launchFirefoxInKioskMode(url) {
  console.log(`=== LAUNCHING FIREFOX KIOSK ===`);
  firefoxLaunched = true;
  
  showCornerOverlay();
  
  setTimeout(() => {
    if (!firefoxLaunched) return;
    
    const firefoxCommand = `firefox --new-window --kiosk "${url}"`;
    console.log('Executing:', firefoxCommand);
    
    exec(firefoxCommand, { env: { ...process.env, DISPLAY: ':0' } }, (error) => {
      if (!firefoxLaunched) return;
      
      if (error) {
        console.log('Trying firefox-esr...');
        const esrCommand = `firefox-esr --new-window --kiosk "${url}"`;
        exec(esrCommand, { env: { ...process.env, DISPLAY: ':0' } }, (esrError) => {
          if (!firefoxLaunched) return;
          if (esrError) {
            console.error('Firefox not available:', esrError.message);
            hideCornerOverlay();
            shell.openExternal(url);
          }
        });
      }
    });
  }, 2000);
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
    });
    
    // Try fullscreen after delay
    setTimeout(() => {
      if (!stremioLaunched) return;
      
      exec('xdotool search --onlyvisible --name "Stremio"', (error, output) => {
        if (!error && output.trim()) {
          const windowId = output.trim().split('\n')[0];
          exec(`xdotool windowactivate ${windowId} && sleep 0.5 && xdotool key --window ${windowId} F11`);
        }
      });
    }, 4000);
  }, 2000);
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
});

app.on('window-all-closed', () => {
  firefoxLaunched = false;
  stremioLaunched = false;
  hideCornerOverlay();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
