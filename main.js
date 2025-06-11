const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { spawn, exec } = require('child_process');
const path = require('path');
const psList = require('ps-list');

class StreamingLauncher {
    constructor() {
        this.mainWindow = null;
        this.currentProcess = null;
        this.isDevMode = process.argv.includes('--dev');
        
        // Store service configurations
        this.services = {
            netflix: {
                name: 'Netflix',
                command: ['firefox', '--new-instance', '--kiosk', '--no-first-run', '--disable-session-crashed-bubble', 'https://netflix.com'],
                processName: 'firefox',
                icon: '🎬'
            },
            youtube: {
                name: 'YouTube TV',
                command: ['firefox', '--new-instance', '--kiosk', '--no-first-run', '--disable-session-crashed-bubble', 'https://youtube.com/tv'],
                processName: 'firefox',
                icon: '📺'
            },
            hbo: {
                name: 'HBO Max',
                command: ['firefox', '--new-instance', '--kiosk', '--no-first-run', '--disable-session-crashed-bubble', 'https://play.hbomax.com'],
                processName: 'firefox',
                icon: '🎭'
            },
            disney: {
                name: 'Disney+',
                command: ['firefox', '--new-instance', '--kiosk', '--no-first-run', '--disable-session-crashed-bubble', 'https://disneyplus.com'],
                processName: 'firefox',
                icon: '🏰'
            },
            stremio: {
                name: 'Stremio',
                command: ['stremio', '--fullscreen'],
                processName: 'stremio',
                icon: '🎯',
                postLaunch: 'fullscreen'
            },
            vlc: {
                name: 'VLC Player',
                command: ['vlc', '--intf', 'qt', '--fullscreen'],
                processName: 'vlc',
                icon: '🎵'
            },
            plex: {
                name: 'Plex',
                command: ['firefox', '--new-instance', '--kiosk', '--no-first-run', '--disable-session-crashed-bubble', 'https://app.plex.tv'],
                processName: 'firefox',
                icon: '📱'
            },
            prime: {
                name: 'Prime Video',
                command: ['firefox', '--new-instance', '--kiosk', '--no-first-run', '--disable-session-crashed-bubble', 'https://primevideo.com'],
                processName: 'firefox',
                icon: '📦'
            }
        };
    }

    async createWindow() {
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width, height } = primaryDisplay.workAreaSize;

        this.mainWindow = new BrowserWindow({
            width: width,
            height: height,
            fullscreen: !this.isDevMode,
            frame: false,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, 'preload.js')
            },
            backgroundColor: '#0a0e1a',
            show: false
        });

        await this.mainWindow.loadFile('index.html');
        
        // Show window when ready
        this.mainWindow.once('ready-to-show', () => {
            this.mainWindow.show();
            if (this.isDevMode) {
                this.mainWindow.webContents.openDevTools();
            }
        });

        // Handle window closed
        this.mainWindow.on('closed', () => {
            this.mainWindow = null;
        });

        // Send services to renderer
        this.mainWindow.webContents.once('dom-ready', () => {
            this.mainWindow.webContents.send('services-data', this.services);
        });
    }

    async launchService(serviceId) {
        const service = this.services[serviceId];
        if (!service) {
            console.error(`Service ${serviceId} not found`);
            return;
        }

        console.log(`Launching ${service.name}...`);
        
        try {
            // Hide the launcher window
            this.mainWindow.hide();
            
            // Kill existing Firefox processes if launching a web service
            if (service.processName === 'firefox') {
                try {
                    spawn('pkill', ['-f', 'firefox'], { stdio: 'ignore' });
                    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for processes to close
                } catch (error) {
                    // Ignore errors, Firefox might not be running
                }
            }
            
            // Launch the service
            this.currentProcess = spawn(service.command[0], service.command.slice(1), {
                detached: true,
                stdio: 'ignore'
            });

            // Handle post-launch actions (like sending F11 for fullscreen)
            if (service.postLaunch === 'fullscreen') {
                setTimeout(() => {
                    this.sendFullscreenKey(service.name);
                }, 3000); // Wait 3 seconds for app to load
            }

            // Monitor the process
            this.monitorProcess(service);

        } catch (error) {
            console.error(`Failed to launch ${service.name}:`, error);
            this.showLauncher();
        }
    }

    sendFullscreenKey(appName) {
        try {
            // Send F11 key to the focused window using xdotool
            spawn('xdotool', ['key', 'F11'], { stdio: 'ignore' });
            console.log(`Sent F11 to ${appName}`);
        } catch (error) {
            console.log(`Could not send F11 key (xdotool not installed?): ${error.message}`);
        }
    }

    async monitorProcess(service) {
        const checkInterval = 3000; // Check every 3 seconds
        let processFound = false;
        let stableCount = 0;
        
        // Wait a bit for process to fully start
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const monitor = setInterval(async () => {
            try {
                const processes = await psList();
                const isRunning = processes.some(proc => 
                    proc.name.toLowerCase().includes(service.processName.toLowerCase()) ||
                    proc.cmd?.toLowerCase().includes(service.processName.toLowerCase())
                );

                if (isRunning) {
                    processFound = true;
                    stableCount = 0; // Reset counter when process is found
                } else if (processFound) {
                    // Process was running but now isn't
                    stableCount++;
                    
                    // Wait for 2 consecutive checks before returning to launcher
                    if (stableCount >= 2) {
                        console.log(`${service.name} process ended`);
                        clearInterval(monitor);
                        setTimeout(() => this.showLauncher(), 1000);
                    }
                } else {
                    // Process never started, keep waiting for a bit longer
                    stableCount++;
                    if (stableCount >= 10) { // 30 seconds max wait
                        console.log(`${service.name} failed to start`);
                        clearInterval(monitor);
                        this.showLauncher();
                    }
                }
            } catch (error) {
                console.error('Error monitoring process:', error);
                clearInterval(monitor);
                setTimeout(() => this.showLauncher(), 2000);
            }
        }, checkInterval);

        // Fallback timeout (45 minutes max)
        setTimeout(() => {
            clearInterval(monitor);
        }, 45 * 60 * 1000);
    }

    showLauncher() {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.show();
            this.mainWindow.focus();
        }
    }

    setupIPC() {
        ipcMain.handle('launch-service', async (event, serviceId) => {
            await this.launchService(serviceId);
        });

        ipcMain.handle('quit-app', () => {
            app.quit();
        });

        ipcMain.handle('get-services', () => {
            return this.services;
        });
    }

    async initialize() {
        await app.whenReady();
        
        this.setupIPC();
        await this.createWindow();
        
        app.on('window-all-closed', () => {
            if (process.platform !== 'darwin') {
                app.quit();
            }
        });

        app.on('activate', async () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                await this.createWindow();
            }
        });
    }
}

// Initialize the launcher
const launcher = new StreamingLauncher();
launcher.initialize().catch(console.error);
