#!/bin/bash

# simple-kiosk.sh - Global kiosk manager with keyboard shortcuts
# Works across ALL applications and websites

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIOSK_HTML="$SCRIPT_DIR/kiosk.html"
FIREFOX_PROFILE="$HOME/.mozilla/firefox/kiosk-profile"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log() { echo -e "${GREEN}[KIOSK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Create Firefox profile if needed
setup_firefox_profile() {
    if [ ! -d "$FIREFOX_PROFILE" ]; then
        log "Creating Firefox kiosk profile..."
        firefox -CreateProfile "kiosk $FIREFOX_PROFILE" -headless 2>/dev/null
        
        # Create preferences
        cat > "$FIREFOX_PROFILE/user.js" << 'EOF'
// Kiosk preferences
user_pref("browser.fullscreen.autohide", true);
user_pref("browser.sessionstore.resume_from_crash", false);
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.tabs.warnOnClose", false);
user_pref("browser.warnOnQuit", false);
user_pref("signon.rememberSignons", true);
user_pref("signon.autofillForms", true);
user_pref("toolkit.legacyUserProfileCustomizations.stylesheets", true);
EOF

        # Create userChrome.css for visual improvements
        mkdir -p "$FIREFOX_PROFILE/chrome"
        cat > "$FIREFOX_PROFILE/chrome/userChrome.css" << 'EOF'
@namespace url("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul");

/* Hide all UI in fullscreen for clean kiosk mode */
#main-window[sizemode="fullscreen"] #navigator-toolbox {
  display: none !important;
}
EOF
        log "Firefox profile created"
    fi
}

# Setup global keyboard shortcuts
setup_shortcuts() {
    log "Setting up global keyboard shortcuts..."
    
    # Create shortcut script
    cat > /tmp/kiosk-shortcuts.sh << 'EOF'
#!/bin/bash
while true; do
    # Monitor for key combinations using xbindkeys-like approach
    xinput test-xi2 --root 2>/dev/null | while read line; do
        # This is a simplified approach - in practice you'd use xbindkeys
        sleep 0.1
    done
done
EOF
    chmod +x /tmp/kiosk-shortcuts.sh
    
    # Create xbindkeys config if xbindkeys is available
    if command -v xbindkeys &> /dev/null; then
        cat > ~/.xbindkeysrc << EOF
# Kiosk keyboard shortcuts
"$SCRIPT_DIR/simple-kiosk.sh home"
    control + alt + h

"$SCRIPT_DIR/simple-kiosk.sh back"
    control + alt + Left

"$SCRIPT_DIR/simple-kiosk.sh forward"
    control + alt + Right

"$SCRIPT_DIR/simple-kiosk.sh refresh"
    control + alt + r

"$SCRIPT_DIR/simple-kiosk.sh close"
    control + alt + q

"$SCRIPT_DIR/simple-kiosk.sh netflix"
    control + alt + 1

"$SCRIPT_DIR/simple-kiosk.sh youtube"
    control + alt + 2

"$SCRIPT_DIR/simple-kiosk.sh stremio"
    control + alt + 3
EOF
        
        # Start xbindkeys
        pkill xbindkeys 2>/dev/null
        xbindkeys &
        log "Global shortcuts enabled:"
        log "  Ctrl+Alt+H - Home"
        log "  Ctrl+Alt+← - Back"
        log "  Ctrl+Alt+→ - Forward"
        log "  Ctrl+Alt+R - Refresh"
        log "  Ctrl+Alt+Q - Close/Exit"
        log "  Ctrl+Alt+1 - Netflix"
        log "  Ctrl+Alt+2 - YouTube"
        log "  Ctrl+Alt+3 - Stremio"
    else
        warn "xbindkeys not available - install with: sudo pacman -S xbindkeys"
        log "Manual shortcuts available - call script directly:"
        log "  $0 home|back|forward|refresh|close"
    fi
}

# Navigation functions
go_home() {
    log "Going to home screen..."
    local firefox_window=$(xdotool search --onlyvisible --name "Mozilla Firefox" | head -1)
    
    if [ -n "$firefox_window" ]; then
        xdotool windowactivate "$firefox_window"
        sleep 0.2
        
        # Navigate to home
        xdotool key --window "$firefox_window" ctrl+l
        sleep 0.1
        xdotool type --window "$firefox_window" "file://$KIOSK_HTML"
        xdotool key --window "$firefox_window" Return
        
        log "Navigated to home screen"
    else
        # No Firefox window, start fresh
        start_kiosk
    fi
}

go_back() {
    log "Going back..."
    send_key_to_firefox "alt+Left"
}

go_forward() {
    log "Going forward..."
    send_key_to_firefox "alt+Right"
}

refresh_page() {
    log "Refreshing page..."
    send_key_to_firefox "F5"
}

close_current() {
    log "Closing current application..."
    
    # Try to close current tab/window gracefully first
    send_key_to_firefox "ctrl+w"
    sleep 1
    
    # If still running, go home
    if pgrep firefox > /dev/null; then
        go_home
    fi
}

quit_kiosk() {
    log "Exiting kiosk mode..."
    pkill firefox 2>/dev/null
    pkill stremio 2>/dev/null
    pkill xbindkeys 2>/dev/null
    
    # Re-enable normal desktop environment
    xset s on
    xset +dpms
    
    log "Kiosk mode exited"
}

# Quick launch functions
launch_netflix() {
    log "Launching Netflix..."
    navigate_to "https://www.netflix.com"
}

launch_youtube() {
    log "Launching YouTube..."
    navigate_to "https://www.youtube.com"
}

launch_stremio() {
    log "Launching Stremio..."
    
    # Try to launch Stremio app
    if command -v stremio &> /dev/null; then
        stremio &
        sleep 3
        
        # Try to make it fullscreen
        local stremio_window=$(xdotool search --onlyvisible --name "Stremio" | head -1)
        if [ -n "$stremio_window" ]; then
            xdotool windowactivate "$stremio_window"
            sleep 1
            xdotool key --window "$stremio_window" F11
        fi
    else
        # Fallback to web version
        navigate_to "https://web.stremio.com"
    fi
}

# Helper functions
send_key_to_firefox(){ 
    local firefox_window=$(xdotool search --onlyvisible --name "Mozilla Firefox" | head -1)
    if [ -n "$firefox_window" ]; then
        xdotool windowactivate "$firefox_window"
        sleep 0.1
        xdotool key --window "$firefox_window" "$1"
    fi
}

navigate_to() {
    local url="$1"
    local firefox_window=$(xdotool search --onlyvisible --name "Mozilla Firefox" | head -1)
    
    if [ -n "$firefox_window" ]; then
        xdotool windowactivate "$firefox_window"
        sleep 0.2
        xdotool key --window "$firefox_window" ctrl+l
        sleep 0.1
        xdotool type --window "$firefox_window" "$url"
        xdotool key --window "$firefox_window" Return
    else
        # Start Firefox with the URL
        firefox --profile "$FIREFOX_PROFILE" --kiosk "$url" &
        sleep 3
        ensure_fullscreen
    fi
}

ensure_fullscreen() {
    local firefox_window=$(xdotool search --onlyvisible --name "Mozilla Firefox" | head -1)
    if [ -n "$firefox_window" ]; then
        xdotool windowactivate "$firefox_window"
        sleep 0.5
        xdotool key --window "$firefox_window" F11
        
        # Force window properties
        wmctrl -i -r "$firefox_window" -b add,above 2>/dev/null
    fi
}

start_kiosk() {
    log "Starting kiosk mode..."
    
    # Setup environment
    xset s off
    xset -dpms
    xset s noblank
    
    # Hide cursor if unclutter available
    if command -v unclutter &> /dev/null; then
        unclutter -idle 5 &
    fi
    
    # Setup Firefox profile
    setup_firefox_profile
    
    # Setup shortcuts
    setup_shortcuts
    
    # Launch Firefox with home page
    log "Launching Firefox..."
    firefox --profile "$FIREFOX_PROFILE" --kiosk "file://$KIOSK_HTML" &
    
    sleep 3
    ensure_fullscreen
    
    log "Kiosk started successfully"
    log ""
    log "Navigation options:"
    log "1. Use keyboard shortcuts (if xbindkeys installed)"
    log "2. Run commands manually: $0 home|back|forward|refresh|close"
    log "3. Quick launch: $0 netflix|youtube|stremio"
}

show_help() {
    echo "Simple Kiosk Manager"
    echo ""
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  start     - Start kiosk mode"
    echo "  stop      - Stop kiosk mode"
    echo "  home      - Go to home screen"
    echo "  back      - Browser back"
    echo "  forward   - Browser forward"
    echo "  refresh   - Refresh current page"
    echo "  close     - Close current app/tab"
    echo "  netflix   - Launch Netflix"
    echo "  youtube   - Launch YouTube"
    echo "  stremio   - Launch Stremio"
    echo ""
    echo "Global shortcuts (if xbindkeys installed):"
    echo "  Ctrl+Alt+H - Home"
    echo "  Ctrl+Alt+← - Back"
    echo "  Ctrl+Alt+→ - Forward"
    echo "  Ctrl+Alt+R - Refresh"
    echo "  Ctrl+Alt+Q - Close/Exit"
    echo "  Ctrl+Alt+1 - Netflix"
    echo "  Ctrl+Alt+2 - YouTube"
    echo "  Ctrl+Alt+3 -
