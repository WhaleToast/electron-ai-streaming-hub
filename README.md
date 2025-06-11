# IF YOU FOUND THIS. BEWARE. THIS IS 99% VIBE CODED. PURE AI BABY
I have tested and it works, but everything you see here is made by ChatGPT or Claude. I only made some small changes once everything was working.
Honestly kinda crazy that it even works


# 🎬 Streaming Launcher for Intel NUC

A modern, mouse-controlled streaming launcher built with Electron for Arch Linux + Openbox. Perfect for converting your Intel NUC into a dedicated streaming box.

![Streaming Launcher](https://via.placeholder.com/800x450/0a0e1a/ffffff?text=Modern+Streaming+Interface)

## ✨ Features

- **Mouse-Only Control**: Designed specifically for TV/couch use with large, clickable tiles
- **Modern UI**: Glassmorphism design with smooth animations and hover effects
- **Native App Support**: Properly handles fullscreen native applications like Stremio
- **Process Monitoring**: Automatically returns to launcher when apps close
- **Customizable Services**: Easy to add/remove streaming services
- **Settings Panel**: Toggle display options and preferences
- **Time Display**: Shows current time and date
- **Keyboard Shortcuts**: Number keys (1-8) for quick launch, Ctrl+Q to quit

## 🎯 Supported Services

**Pre-configured streaming services:**
- Netflix
- YouTube TV
- HBO Max
- Disney+
- Prime Video
- Plex
- Stremio (native app)
- VLC Player

## 🛠️ Installation

### Automatic Installation (Recommended)

1. **Download all files** to a directory on your Intel NUC
2. **Run the installation script**:
   ```bash
   chmod +x install.sh
   ./install.sh
   ```
3. **Install additional streaming apps** (optional):
   ```bash
   yay -S stremio vlc
   ```

### Manual Installation

1. **Install dependencies**:
   ```bash
   sudo pacman -S nodejs npm firefox xorg-server xorg-xinit openbox
   ```

2. **Install Electron**:
   ```bash
   yay -S electron
   ```

3. **Create application directory**:
   ```bash
   mkdir -p ~/.local/share/streaming-launcher
   cd ~/.local/share/streaming-launcher
   ```

4. **Copy application files** and install dependencies:
   ```bash
   # Copy: package.json, main.js, preload.js, index.html, styles.css, renderer.js
   npm install --production
   ```

5. **Create start script**:
   ```bash
   echo '#!/bin/bash\ncd "$(dirname "$0")"\nelectron .' > start.sh
   chmod +x start.sh
   ```

## 🖥️ Setting Up Auto-Start

### For Kiosk Mode (Recommended)

1. **Enable auto-login**:
   ```bash
   sudo systemctl edit getty@tty1
   ```
   Add these lines:
   ```ini
   [Service]
   ExecStart=
   ExecStart=-/usr/bin/agetty --autologin YOUR_USERNAME --noclear %I $TERM
   ```

2. **Auto-start X server**, add to `~/.bash_profile`:
   ```bash
   if [ -z "$DISPLAY" ] && [ "$XDG_VTNR" = 1 ]; then
     exec startx
   fi
   ```

3. **Configure Openbox autostart** in `~/.config/openbox/autostart`:
   ```bash
   ~/.local/share/streaming-launcher/start.sh &
   ```

## ⚙️ Configuration

### Adding New Services

Edit `main.js` and add to the `services` object:

```javascript
newservice: {
    name: 'Service Name',
    command: ['command', '--flags', 'url'],
    processName: 'process-name',
    icon: '🎵'
}
```

### Customizing Appearance

Modify `styles.css` to change:
- Color schemes
- Button sizes
- Animations
- Grid layout

### Browser Configuration

For optimal streaming experience, Firefox starts with:
- `--kiosk` mode (fullscreen, no UI)
- `--no-first-run` (skip setup screens)

## 🎮 Usage

### Mouse Controls
- **Click any service tile** to launch
- **Settings button** (⚙️) to open preferences
- **Quit button** (❌) to exit launcher

### Keyboard Shortcuts
- **Number keys (1-8)**: Launch services by position
- **Ctrl + Q**: Quit application
- **Escape**: Open/close settings

### Returning to Launcher
The launcher automatically reappears when:
- Streaming apps are closed
- Browser windows are closed
- Native applications exit

## 🔧 Troubleshooting

### Applications Don't Launch
1. **Check if applications are installed**:
   ```bash
   which firefox stremio vlc
   ```
2. **Verify paths in main.js** match your system
3. **Check terminal output** when running launcher

### Launcher Doesn't Return
1. **Process monitoring may fail** - restart launcher
2. **For native apps**: Make sure process names in `main.js` are correct
3. **Check process list**: `ps aux | grep stremio`

### Fullscreen Issues
1. **Openbox configuration**: Window rules in `~/.config/openbox/rc.xml`
2. **Application-specific**: Some apps need specific launch flags
3. **Multiple monitors**: May need display configuration

### Audio/Video Issues
1. **Install codecs**:
   ```bash
   sudo pacman -S gst-plugins-good gst-plugins-bad gst-plugins-ugly
   ```
2. **Configure PulseAudio**:
   ```bash
   sudo pacman -S pulseaudio pulseaudio-alsa
   ```

## 🔄 Development

### Running in Development Mode
```bash
cd ~/.local/share/streaming-launcher
npm run dev
```

### Building for Distribution
```bash
npm run build
```

### File Structure
```
streaming-launcher/
├── package.json          # Dependencies and scripts
├── main.js               # Electron main process
├── preload.js            # Security bridge
├── index.html            # UI structure
├── styles.css            # Modern styling
├── renderer.js           # UI logic
└── README.md             # This file
```

## 🎨 Customization Ideas

- **Theme switching**: Dark/light mode toggle
- **Service categories**: Group by type (movies, music, etc.)
- **Recently used**: Show most launched services first
- **Parental controls**: PIN-protected services
- **Network status**: Show internet connectivity
- **System stats**: CPU/memory usage display

## 📋 Requirements

- **OS**: Arch Linux (adaptable to other distributions)
- **WM**: Openbox (or any window manager)
- **Node.js**: 16+ (for Electron)
- **Display**: HDMI/DisplayPort output to TV
- **Input**: USB mouse (keyboard optional)

## 🤝 Contributing

Feel free to:
- Add new streaming services
- Improve the UI/UX
- Fix bugs and issues
- Add new features
- Create themes

## 📄 License

MIT License - Feel free to modify and distribute!

---

**Enjoy your new streaming box! 🍿📺**
