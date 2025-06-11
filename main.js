const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const psList = require('ps-list');

class StreamingLauncher {
    constructor() {
        this.mainWindow = null;
        this.overlayWindow = null;
        this.currentProcess = null;
        this.isDevMode = process.argv.includes('--dev');
        this.services = {
            netflix: {
                name: 'Netflix',
                command: ['firefox', '--new-instance', '--kiosk', '--no-first-run', '--disable-session-crashed-bubble', 'https://netflix.com'],
                processName: 'firefox',
                icon: '🎬'
            },
            youtube: {
                name: 'YouTube TV',
                command: ['firefox', '--new-instance', '--kiosk', '--no-first-run', '--disable-session-crashed-bubble', 'https://youtube.com/'],
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
                command: ['stremio'],
                processName: 'stremio',
                icon: '🎯',
                postLaunch: 'fullscreen'
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
            width,
            height,
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

        this.mainWindow.once('ready-to-show', () => {
            this.mainWindow.show();
            if (this.isDevMode) this.mainWindow.webContents.openDevTools();
        });

        this.mainWindow.on('closed', () => {
            this.mainWindow = null;
        });

        this.mainWindow.webContents.once('dom-ready', () => {
            this.mainWindow.webContents.send('services-data', this.services);
        });
    }

    createOverlayWindow() {
        this.overlayWindow = new BrowserWindow({
            width: 100,
            height: 60,
            transparent: true,
            frame: false,
            alwaysOnTop: true,
            skipTaskbar: true,
            resizable: false,
            focusable: false,
            x: 0,
            y: 0,
            hasShadow: false,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, 'overlayPreload.js')
            }
        });

        this.overlayWindow.setAlwaysOnTop(true, 'screen-saver');
        this.overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        this.overlayWindow.loadFile('overlay.html');
        this.overlayWindow.hide();
    }

    async launchService(serviceId) {
        const service = this.services[serviceId];
        if (!service) {
            console.error(`Service ${serviceId} not found`);
            return;
        }

        console.log(`Launching ${service.name}...`);

        try {
            // this.mainWindow.hide();
            this.overlayWindow.show();

            if (service.processName === 'firefox') {
                try {
                    spawn('pkill', ['-f', 'firefox'], { stdio: 'ignore' });
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch {}
            }

            this.currentProcess = spawn(service.command[0], service.command.slice(1), {
                detached: true,
                stdio: 'ignore'
            });

            if (service.postLaunch === 'fullscreen') {
                setTimeout(() => this.sendFullscreenKey(service.name), 2000);
            }

            // Disabled auto monitor logic (manual control via overlay)
            // this.monitorProcess(service);

        } catch (error) {
            console.error(`Failed to launch ${service.name}:`, error);
            this.showLauncher();
        }
    }

    terminateCurrentService() {
        if (!this.currentProcess) {
            this.showLauncher();
            return;
        }

        const processName = this.currentProcess.spawnfile || this.currentProcess.file || null;
        const baseName = processName ? path.basename(processName) : null;

        if (baseName) {
            spawn('pkill', ['-f', baseName], { stdio: 'ignore' });
            console.log(`Terminated process: ${baseName}`);
        } else {
            console.warn('No active process to terminate.');
        }

        this.currentProcess = null;
        this.showLauncher();
    }

    sendFullscreenKey(appName) {
        try {
            spawn('xdotool', ['key', 'F11'], { stdio: 'ignore' });
            console.log(`Sent F11 to ${appName}`);
        } catch (error) {
            console.log(`Could not send F11 key: ${error.message}`);
        }
    }

    showLauncher() {
        if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
            this.overlayWindow.hide();
        }

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

        ipcMain.on('show-launcher', () => {
            this.terminateCurrentService();
        });
        ipcMain.handle('shutdown', () => {
            spawn('systemctl', ['poweroff'], { stdio: 'ignore', detached: true });
        });

        ipcMain.handle('restart', () => {
        spawn('systemctl', ['reboot'], { stdio: 'ignore', detached: true });
        });
    }

    async initialize() {
        await app.whenReady();
        this.setupIPC();
        await this.createWindow();
        this.createOverlayWindow();

        app.on('window-all-closed', () => {
            if (process.platform !== 'darwin') app.quit();
        });

        app.on('activate', async () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                await this.createWindow();
            }
        });
    }
}

const launcher = new StreamingLauncher();
launcher.initialize().catch(console.error);

