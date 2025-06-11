#!/bin/bash

# kiosk-launcher.sh - Modern media center launcher
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIOSK_HTML="$SCRIPT_DIR/kiosk.html"
KIOSK_PID_FILE="/tmp/kiosk.pid"

# Configuration
FIREFOX_PROFILE_DIR="$HOME/.mozilla/firefox/kiosk-profile"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() {
    echo -e "${GREEN}[KIOSK]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check dependencies
check_dependencies() {
    local missing=()
    
    for cmd in firefox xdotool wmctrl; do
        if ! command -v "$cmd" &> /dev/null; then
            missing+=("$cmd")
        fi
    done
    
    if [ ${#missing[@]} -ne 0 ]; then
        error "Missing dependencies: ${missing[*]}"
        echo "Install with: sudo pacman -S firefox xdotool wmctrl"
        exit 1
    fi
}

# Create Firefox profile for kiosk mode
create_firefox_profile() {
    if [ ! -d "$FIREFOX_PROFILE_DIR" ]; then
        log "Creating Firefox kiosk profile..."
        firefox -CreateProfile "kiosk $FIREFOX_PROFILE_DIR" -headless
        
        # Create user preferences for kiosk mode
        cat > "$FIREFOX_PROFILE_DIR/user.js" << 'EOF'
// Kiosk mode preferences
user_pref("browser.fullscreen.autohide", true);
user_pref("browser.sessionstore.resume_from_crash", false);
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.startup.homepage", "about:blank");
user_pref("browser.tabs.warnOnClose", false);
user_pref("browser.tabs.warnOnCloseOtherTabs", false);
user_pref("browser.warnOnQuit", false);
user_pref("datareporting.healthreport.service.enabled", false);
user_pref("datareporting.healthreport.uploadEnabled", false);
user_pref("datareporting.policy.dataSubmissionEnabled", false);
user_pref("toolkit.telemetry.enabled", false);
user_pref("browser.privatebrowsing.autostart", false);
user_pref("signon.rememberSignons", true);
user_pref("signon.autofillForms", true);
user_pref("security.ask_for_password", 0);
EOF
        log "Firefox profile created at $FIREFOX_PROFILE_DIR"
    fi
}

# Launch the kiosk interface
start_kiosk() {
    log "Starting Media Center Kiosk..."
    
    # Kill any existing Firefox instances
    pkill firefox 2>/dev/null || true
    pkill stremio 2>/dev/null || true
    
    # Wait a moment for processes to clean up
    sleep 2
    
    # Set up kiosk environment
    setup_environment
    
    # Start simple backend server for handling close requests
    start_backend_server &
    local backend_pid=$!
    
    # Launch Firefox with the kiosk interface
    log "Launching Firefox in kiosk mode..."
    firefox \
        --profile "$FIREFOX_PROFILE_DIR" \
        --kiosk \
        --new-instance \
        "file://$KIOSK_HTML" &
    
    local firefox_pid=$!
    echo "$firefox_pid $backend_pid" > "$KIOSK_PID_FILE"
    
    log "Kiosk started with Firefox PID: $firefox_pid, Backend PID: $backend_pid"
    log "HTML file: $KIOSK_HTML"
    
    # Wait for Firefox to start
    sleep 3
    
    # Try to ensure it's fullscreen
    ensure_fullscreen
    
    # Wait for Firefox to exit
    wait $firefox_pid
    
    # Clean up backend
    if kill -0 $backend_pid 2>/dev/null; then
        kill $backend_pid
    fi
    
    log "Kiosk session ended"
    cleanup
}

# Simple backend server to handle close requests
start_backend_server() {
    # Create a simple HTTP server using netcat or Python
    if command -v python3 &> /dev/null; then
        python3 -c "
import http.server
import socketserver
import subprocess
import json
import sys
from urllib.parse import urlparse, parse_qs

class KioskHandler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path == '/close-kiosk':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(b'{\"status\": \"closing\"}')
            
            # Kill Firefox and exit
            subprocess.run(['pkill', 'firefox'], capture_output=True)
            sys.exit(0)
            
        elif self.path == '/launch-stremio':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(b'{\"status\": \"launching\"}')
            
            # Launch Stremio
            try:
                subprocess.Popen(['stremio'], env={'DISPLAY': ':0'})
            except:
                try:
                    subprocess.Popen(['flatpak', 'run', 'com.stremio.Stremio'], env={'DISPLAY': ':0'})
                except:
                    pass
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
    
    def log_message(self, format, *args):
        pass  # Suppress logs

with socketserver.TCPServer(('127.0.0.1', 8888), KioskHandler) as httpd:
    httpd.serve_forever()
" 2>/dev/null &
    fi
}

# Set up kiosk environment
setup_environment() {
    log "Setting up kiosk environment..."
    
    # Disable screensaver and power management
    xset s off
    xset -dpms
    xset s noblank
    
    # Hide cursor after inactivity (if unclutter is available)
    if command -v unclutter &> /dev/null; then
        unclutter -idle 5 -root &
    fi
    
    # Set background to black
    xsetroot -solid black 2>/dev/null || true
}

# Ensure Firefox is in fullscreen mode
ensure_fullscreen() {
    log "Ensuring fullscreen mode..."
    
    # Give Firefox a moment to fully load
    sleep 2
    
    # Find Firefox window and ensure it's fullscreen
    local firefox_window=$(xdotool search --onlyvisible --name "Mozilla Firefox" | head -1)
    
    if [ -n "$firefox_window" ]; then
        log "Found Firefox window: $firefox_window"
        
        # Activate window
        xdotool windowactivate "$firefox_window"
        sleep 1
        
        # Send F11 to ensure fullscreen
        xdotool key --window "$firefox_window" F11
        
        # Make sure it stays on top
        wmctrl -i -r "$firefox_window" -b add,above
        
        log "Firefox set to fullscreen"
    else
        warn "Could not find Firefox window"
    fi
}

# Launch Stremio
launch_stremio() {
    log "Launching Stremio..."
    
    # Kill existing Firefox
    pkill firefox 2>/dev/null || true
    sleep 1
    
    # Launch Stremio
    if command -v stremio &> /dev/null; then
        stremio &
        local stremio_pid=$!
        
        # Wait for Stremio to load
        sleep 4
        
        # Try to make it fullscreen
        local stremio_window=$(xdotool search --onlyvisible --name "Stremio" | head -1)
        if [ -n "$stremio_window" ]; then
            xdotool windowactivate "$stremio_window"
            sleep 1
            xdotool key --window "$stremio_window" F11
            log "Stremio launched in fullscreen"
        fi
        
        wait $stremio_pid
    else
        # Try flatpak version
        if command -v flatpak &> /dev/null; then
            flatpak run com.stremio.Stremio &
            local flatpak_pid=$!
            wait $flatpak_pid
        else
            error "Stremio not found. Install with: sudo pacman -S stremio"
            return 1
        fi
    fi
}

# Stop the kiosk
stop_kiosk() {
    log "Stopping kiosk..."
    
    if [ -f "$KIOSK_PID_FILE" ]; then
        local pids=$(cat "$KIOSK_PID_FILE")
        for pid in $pids; do
            if kill -0 "$pid" 2>/dev/null; then
                kill "$pid"
                log "Killed process $pid"
            fi
        done
        rm -f "$KIOSK_PID_FILE"
    fi
    
    # Kill all related processes
    pkill firefox 2>/dev/null || true
    pkill stremio 2>/dev/null || true
    pkill unclutter 2>/dev/null || true
    pkill -f "python3.*8888" 2>/dev/null || true
    
    cleanup
}

# Cleanup function
cleanup() {
    log "Cleaning up..."
    
    # Re-enable screensaver
    xset s on
    xset +dpms
    
    # Remove PID file
    rm -f "$KIOSK_PID_FILE"
    
    log "Cleanup complete"
}

# Signal handlers
trap cleanup EXIT
trap 'stop_kiosk' INT TERM

# Check if HTML file exists, create if needed
ensure_html_file() {
    if [ ! -f "$KIOSK_HTML" ]; then
        error "HTML file not found: $KIOSK_HTML"
        echo "Please save the HTML content to: $KIOSK_HTML"
        exit 1
    fi
}

# Main function
main() {
    case "${1:-start}" in
        "start")
            check_dependencies
            ensure_html_file
            create_firefox_profile
            start_kiosk
            ;;
        "stop")
            stop_kiosk
            ;;
        "restart")
            stop_kiosk
            sleep 2
            main start
            ;;
        "stremio")
            launch_stremio
            ;;
        "status")
            if [ -f "$KIOSK_PID_FILE" ]; then
                local pid=$(cat "$KIOSK_PID_FILE")
                if kill -0 "$pid" 2>/dev/null; then
                    log "Kiosk is running (PID: $pid)"
                    exit 0
                else
                    warn "Kiosk PID file exists but process is not running"
                    exit 1
                fi
            else
                warn "Kiosk is not running"
                exit 1
            fi
            ;;
        "profile")
            log "Firefox profile location: $FIREFOX_PROFILE_DIR"
            if [ -d "$FIREFOX_PROFILE_DIR" ]; then
                log "Profile exists"
            else
                warn "Profile does not exist - run 'start' to create it"
            fi
            ;;
        *)
            echo "Usage: $0 {start|stop|restart|stremio|status|profile}"
            echo ""
            echo "Commands:"
            echo "  start    - Start the media center kiosk"
            echo "  stop     - Stop the kiosk"
            echo "  restart  - Restart the kiosk"
            echo "  stremio  - Launch Stremio directly"
            echo "  status   - Check if kiosk is running"
            echo "  profile  - Show Firefox profile information"
            exit 1
            ;;
    esac
}

# Run main function
main "$@"
