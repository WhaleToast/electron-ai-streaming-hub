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
                command: ['firefox', '--kiosk', '--no-first-run', 'https://netflix.com'],
                processName: 'firefox',
                icon: '🎬'
            },
            youtube: {
                name: 'YouTube TV',
                command: ['firefox', '--kiosk', '--no-first-run', 'https://youtube.com/tv'],
                processName: 'firefox',
                icon: '📺'
            },
            hbo: {
                name: 'HBO Max',
                command: ['firefox', '--kiosk', '--no-first-run', 'https://play.hbomax.com'],
                processName: 'firefox',
                icon: '🎭'
            },
            disney: {
                name: 'Disney+',
                command: ['firefox', '--kiosk', '--no-first-run', 'https://disneyplus.com'],
                processName: 'firefox',
                icon: '🏰'
            },
            stremio: {
                name: 'Stremio',
                command: ['stremio'],
                processName: 'stremio',
                icon: '🎯'
            },
            vlc: {
                name: 'VLC Player',
                command: ['vlc', '--intf', 'qt', '--fullscreen'],
                processName: 'vlc',
                icon: '🎵'
            },
            plex: {
                name: 'Plex',
                command: ['firefox', '--kiosk', '--no-first-run', 'https://app.plex.tv'],
                processName: 'firefox',
                icon: '📱'
            },
            prime: {
                name: 'Prime Video',
                command: ['firefox', '--kiosk', '--no-first-run', 'https://primevideo.com'],
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
            
            // Launch the service
            this.currentProcess = spawn(service.command[0], service.command.slice(1), {
                detached: true,
                stdio: 'ignore'
            });

            // Monitor the process
            this.monitorProcess(service);

        } catch (error) {
            console.error(`Failed to launch ${service.name}:`, error);
            this.showLauncher();
        }
    }

    async monitorProcess(service) {
        const checkInterval = 2000; // Check every 2 seconds
        
        const monitor = setInterval(async () => {
            try {
                const processes = await psList();
                const isRunning = processes.some(proc => 
                    proc.name.toLowerCase().includes(service.processName.toLowerCase())
                );

                if (!isRunning) {
                    console.log(`${service.name} process ended`);
                    clearInterval(monitor);
                    setTimeout(() => this.showLauncher(), 1000);
                }
            } catch (error) {
                console.error('Error monitoring process:', error);
                clearInterval(monitor);
                this.showLauncher();
            }
        }, checkInterval);

        // Fallback timeout (30 minutes max)
        setTimeout(() => {
            clearInterval(monitor);
        }, 30 * 60 * 1000);
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
