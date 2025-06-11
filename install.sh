#!/bin/bash

# Streaming Launcher Installation Script for Arch Linux
# Run with: bash install.sh

set -e

echo "🎬 Installing Streaming Launcher for Intel NUC..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running on Arch Linux
if ! command -v pacman &> /dev/null; then
    print_error "This script is designed for Arch Linux. Please install dependencies manually."
    exit 1
fi

print_status "Updating system packages..."
sudo pacman -Syu --noconfirm

# Install required packages
print_status "Installing required packages..."
sudo pacman -S --needed --noconfirm \
    nodejs \
    npm \
    firefox \
    xorg-server \
    xorg-xinit \
    openbox \
    git

# Install AUR helper (yay) if not present
if ! command -v yay &> /dev/null; then
    print_status "Installing yay AUR helper..."
    cd /tmp
    git clone https://aur.archlinux.org/yay.git
    cd yay
    makepkg -si --noconfirm
    cd ~
fi

# Install Electron via AUR (for better system integration)
print_status "Installing Electron..."
yay -S --needed --noconfirm electron

# Create application directory
APP_DIR="$HOME/.local/share/streaming-launcher"
print_status "Creating application directory at $APP_DIR..."
mkdir -p "$APP_DIR"

# Copy application files (assuming they're in current directory)
if [ -f "package.json" ]; then
    print_status "Copying application files..."
    cp package.json main.js preload.js index.html styles.css renderer.js overlayPreloa.js overlay.html "$APP_DIR/"
    
    # Install npm dependencies
    print_status "Installing npm dependencies..."
    cd "$APP_DIR"
    npm install --production
    
    print_success "Application files installed!"
else
    print_warning "Application files not found in current directory."
    print_status "Please manually copy the following files to $APP_DIR:"
    echo "  - package.json"
    echo "  - main.js"
    echo "  - preload.js"
    echo "  - index.html"
    echo "  - styles.css"
    echo "  - renderer.js"
    echo ""
    echo "Then run: cd $APP_DIR && npm install --production"
fi

# Create desktop entry
DESKTOP_DIR="$HOME/.local/share/applications"
mkdir -p "$DESKTOP_DIR"

print_status "Creating desktop entry..."
cat > "$DESKTOP_DIR/streaming-launcher.desktop" << EOF
[Desktop Entry]
Name=Streaming Launcher
Comment=Launch streaming services on your Intel NUC
Exec=$APP_DIR/start.sh
Icon=video-display
Type=Application
Categories=AudioVideo;Video;Player;
StartupNotify=true
NoDisplay=false
EOF

# Create start script
print_status "Creating start script..."
cat > "$APP_DIR/start.sh" << 'EOF'
#!/bin/bash
cd "$(dirname "$0")"
electron .
EOF

chmod +x "$APP_DIR/start.sh"

# Create Openbox autostart entry
OPENBOX_DIR="$HOME/.config/openbox"
mkdir -p "$OPENBOX_DIR"

print_status "Setting up Openbox autostart..."
if [ ! -f "$OPENBOX_DIR/autostart" ]; then
    cat > "$OPENBOX_DIR/autostart" << EOF
# Streaming Launcher autostart
$APP_DIR/start.sh &
EOF
else
    if ! grep -q "streaming-launcher" "$OPENBOX_DIR/autostart"; then
        echo "$APP_DIR/start.sh &" >> "$OPENBOX_DIR/autostart"
    fi
fi

# Create basic Openbox config if it doesn't exist
if [ ! -f "$OPENBOX_DIR/rc.xml" ]; then
    print_status "Creating basic Openbox configuration..."
    cat > "$OPENBOX_DIR/rc.xml" << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<openbox_config xmlns="http://openbox.org/">
  <resistance>
    <strength>10</strength>
    <screen_edge_strength>20</screen_edge_strength>
  </resistance>
  <focus>
    <focusNew>yes</focusNew>
    <followMouse>no</followMouse>
    <focusLast>yes</focusLast>
    <underMouse>no</underMouse>
    <focusDelay>200</focusDelay>
    <raiseOnFocus>no</raiseOnFocus>
  </focus>
  <placement>
    <policy>Smart</policy>
    <center>yes</center>
    <monitor>Primary</monitor>
    <primaryMonitor>1</primaryMonitor>
  </placement>
  <theme>
    <name>Clearlooks</name>
    <titleLayout>NLIMC</titleLayout>
    <keepBorder>yes</keepBorder>
    <animateIconify>yes</animateIconify>
    <font place="ActiveWindow">
      <name>sans</name>
      <size>8</size>
      <weight>bold</weight>
      <slant>normal</slant>
    </font>
    <font place="InactiveWindow">
      <name>sans</name>
      <size>8</size>
      <weight>bold</weight>
      <slant>normal</slant>
    </font>
  </theme>
  <desktops>
    <number>1</number>
    <firstdesk>1</firstdesk>
    <names>
      <name>Streaming</name>
    </names>
    <popupTime>875</popupTime>
  </desktops>
  <resize>
    <drawContents>yes</drawContents>
    <popupShow>Nonpixel</popupShow>
    <popupPosition>Center</popupPosition>
    <popupFixedPosition>
      <x>10</x>
      <y>10</y>
    </popupFixedPosition>
  </resize>
  <applications>
    <application name="streaming-launcher">
      <decor>no</decor>
      <maximized>true</maximized>
      <fullscreen>true</fullscreen>
    </application>
    <application name="firefox">
      <decor>no</decor>
      <maximized>true</maximized>
      <fullscreen>true</fullscreen>
    </application>
    <application name="stremio">
      <decor>no</decor>
      <maximized>true</maximized>
      <fullscreen>true</fullscreen>
    </application>
  </applications>
  <keyboard>
    <keybind key="A-F4">
      <action name="Close"/>
    </keybind>
    <keybind key="A-Tab">
      <action name="NextWindow">
        <finalactions>
          <action name="Focus"/>
          <action name="Raise"/>
          <action name="Unshade"/>
        </finalactions>
      </action>
    </keybind>
  </keyboard>
  <mouse>
    <dragThreshold>1</dragThreshold>
    <doubleClickTime>500</doubleClickTime>
    <screenEdgeWarpTime>400</screenEdgeWarpTime>
    <screenEdgeWarpMouse>false</screenEdgeWarpMouse>
  </mouse>
  <margins>
    <top>0</top>
    <bottom>0</bottom>
    <left>0</left>
    <right>0</right>
  </margins>
</openbox_config>
EOF
fi

# Create .xinitrc if it doesn't exist
if [ ! -f "$HOME/.xinitrc" ]; then
    print_status "Creating .xinitrc..."
    cat > "$HOME/.xinitrc" << 'EOF'
#!/bin/sh
# Start Openbox
exec openbox-session
EOF
    chmod +x "$HOME/.xinitrc"
fi

print_success "Installation complete!"
echo ""
print_status "Next steps:"
echo "1. Install any streaming applications you want (e.g., stremio):"
echo "   yay -S stremio"
echo ""
echo "2. To start the streaming launcher:"
echo "   - From desktop: Find 'Streaming Launcher' in applications"
echo "   - From terminal: $APP_DIR/start.sh"
echo "   - Auto-start with Openbox: startx"
echo ""
echo "3. To set up auto-login and auto-start X:"
echo "   sudo systemctl edit getty@tty1"
echo "   Add the following lines:"
echo "   [Service]"
echo "   ExecStart="
echo "   ExecStart=-/usr/bin/agetty --autologin $(whoami) --noclear %I \$TERM"
echo ""
echo "   Then add to your ~/.bash_profile:"
echo "   if [ -z \"\$DISPLAY\" ] && [ \"\$XDG_VTNR\" = 1 ]; then"
echo "     exec startx"
echo "   fi"
echo ""
print_warning "Note: Make sure to install Firefox and any streaming apps you want to use!"
print_success "Enjoy your new streaming box! 🎬"
