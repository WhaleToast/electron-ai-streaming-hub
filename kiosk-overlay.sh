#!/bin/bash

# kiosk-overlay.sh - A reliable close button overlay for kiosk applications
# This script creates a sliding close button that works with any fullscreen app

# Dependencies check
check_dependencies() {
    local missing=()
    
    for cmd in xdotool xwininfo xprop; do
        if ! command -v "$cmd" &> /dev/null; then
            missing+=("$cmd")
        fi
    done
    
    if [ ${#missing[@]} -ne 0 ]; then
        echo "Missing dependencies: ${missing[*]}"
        echo "Install with: pacman -S xorg-xdotool xorg-xwininfo xorg-xprop"
        exit 1
    fi
}

# Configuration
CORNER_SIZE=50          # Size of corner trigger area
BUTTON_SIZE=60          # Size of close button
SLIDE_SPEED=10          # Animation frames
MONITOR_INTERVAL=0.1    # Mouse position check interval

# State variables
OVERLAY_PID=""
BUTTON_VISIBLE=false
APPS_TO_MONITOR=("firefox" "stremio")

# Create the close button overlay using xterm or similar
create_close_button() {
    local x_pos=$1
    local y_pos=$2
    
    # Kill existing overlay
    if [ -n "$OVERLAY_PID" ]; then
        kill "$OVERLAY_PID" 2>/dev/null
        wait "$OVERLAY_PID" 2>/dev/null
    fi
    
    # Create a simple overlay using xterm with custom appearance
    xterm -geometry "4x2+${x_pos}+${y_pos}" \
          -bg red \
          -fg white \
          -font "*-fixed-bold-*-*-*-24-*" \
          -title "CloseButton" \
          -e bash -c '
            echo -e "\033[31;1m  ✕  \033[0m"
            echo -e "\033[31;1mCLICK\033[0m"
            echo "Press Enter to close apps..."
            read
            # Signal parent to close apps
            touch /tmp/kiosk_close_signal
          ' &
    
    OVERLAY_PID=$!
    
    # Make window stay on top and remove decorations
    sleep 0.2
    local window_id=$(xdotool search --name "CloseButton" | head -1)
    if [ -n "$window_id" ]; then
        xdotool windowsize "$window_id" "$BUTTON_SIZE" "$BUTTON_SIZE"
        # Remove window manager decorations and make it stay on top
        xprop -id "$window_id" -f _MOTIF_WM_HINTS 32c -set _MOTIF_WM_HINTS "0x2, 0x0, 0x0, 0x0, 0x0"
        xdotool windowraise "$window_id"
        
        # Set window to be always on top
        xprop -id "$window_id" -f _NET_WM_STATE 32a -set _NET_WM_STATE "_NET_WM_STATE_ABOVE"
    fi
}

# Get mouse position
get_mouse_pos() {
    eval $(xdotool getmouselocation --shell)
}

# Check if mouse is in corner
is_mouse_in_corner() {
    get_mouse_pos
    [ "$X" -le "$CORNER_SIZE" ] && [ "$Y" -le "$CORNER_SIZE" ]
}

# Check if any monitored apps are running
apps_running() {
    for app in "${APPS_TO_MONITOR[@]}"; do
        if pgrep -f "$app" > /dev/null; then
            return 0
        fi
    done
    return 1
}

# Close all monitored applications
close_apps() {
    echo "Closing applications..."
    
    # Close Firefox (including kiosk mode)
    pkill -f "firefox.*kiosk" 2>/dev/null
    pkill firefox 2>/dev/null
    
    # Close Stremio
    pkill stremio 2>/dev/null
    pkill -f "flatpak.*stremio" 2>/dev/null
    
    # Clean up overlay
    if [ -n "$OVERLAY_PID" ]; then
        kill "$OVERLAY_PID" 2>/dev/null
    fi
    
    echo "Applications closed"
}

# Slide animation (simplified - just show/hide for now)
show_button() {
    if [ "$BUTTON_VISIBLE" = false ]; then
        echo "Showing close button..."
        create_close_button -50 10  # Start slightly off-screen
        BUTTON_VISIBLE=true
        
        # Animate slide in (simplified)
        for i in $(seq 5); do
            local x_pos=$((10 - i * 2))
            if [ -n "$OVERLAY_PID" ] && kill -0 "$OVERLAY_PID" 2>/dev/null; then
                local window_id=$(xdotool search --name "CloseButton" | head -1)
                if [ -n "$window_id" ]; then
                    xdotool windowmove "$window_id" "$x_pos" 10
                fi
            fi
            sleep 0.05
        done
    fi
}

hide_button() {
    if [ "$BUTTON_VISIBLE" = true ]; then
        echo "Hiding close button..."
        
        # Animate slide out
        if [ -n "$OVERLAY_PID" ] && kill -0 "$OVERLAY_PID" 2>/dev/null; then
            local window_id=$(xdotool search --name "CloseButton" | head -1)
            if [ -n "$window_id" ]; then
                for i in $(seq 5); do
                    local x_pos=$((10 - i * 12))
                    xdotool windowmove "$window_id" "$x_pos" 10
                    sleep 0.05
                done
            fi
        fi
        
        # Kill overlay
        if [ -n "$OVERLAY_PID" ]; then
            kill "$OVERLAY_PID" 2>/dev/null
            wait "$OVERLAY_PID" 2>/dev/null
        fi
        
        BUTTON_VISIBLE=false
    fi
}

# Main monitoring loop
main_loop() {
    echo "Starting kiosk overlay monitor..."
    echo "Move mouse to top-left corner to show close button"
    
    # Clean up signal file
    rm -f /tmp/kiosk_close_signal
    
    while true; do
        # Check if close signal was triggered
        if [ -f /tmp/kiosk_close_signal ]; then
            rm -f /tmp/kiosk_close_signal
            close_apps
            break
        fi
        
        # Check if apps are still running
        if ! apps_running; then
            echo "No monitored apps running, exiting..."
            break
        fi
        
        # Check mouse position
        if is_mouse_in_corner; then
            show_button
        else
            # Only hide if not hovering over button
            get_mouse_pos
            if [ "$X" -gt $((BUTTON_SIZE + 20)) ] || [ "$Y" -gt $((BUTTON_SIZE + 20)) ]; then
                hide_button
            fi
        fi
        
        sleep "$MONITOR_INTERVAL"
    done
    
    # Cleanup
    hide_button
    echo "Kiosk overlay monitor stopped"
}

# Signal handlers
cleanup() {
    echo "Cleaning up..."
    hide_button
    rm -f /tmp/kiosk_close_signal
    exit 0
}

trap cleanup EXIT INT TERM

# Main execution
case "${1:-monitor}" in
    "check")
        check_dependencies
        echo "All dependencies satisfied"
        ;;
    "close")
        close_apps
        ;;
    "monitor"|"")
        check_dependencies
        main_loop
        ;;
    *)
        echo "Usage: $0 [check|close|monitor]"
        echo "  check   - Check if dependencies are installed"
        echo "  close   - Close all monitored applications"
        echo "  monitor - Start the overlay monitor (default)"
        exit 1
        ;;
esac
