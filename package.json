{
  "name": "streaming-launcher",
  "version": "1.0.0",
  "description": "Modern streaming launcher for Intel NUC",
  "main": "main.js",
  "scripts": {
    "start": "electron .",
    "dev": "electron . --dev",
    "build": "electron-builder"
  },
  "keywords": ["streaming", "launcher", "kiosk"],
  "author": "Your Name",
  "license": "MIT",
  "devDependencies": {
    "electron": "^27.0.0",
    "electron-builder": "^24.6.4"
  },
  "dependencies": {
    "ps-list": "^8.1.1"
  },
  "build": {
    "appId": "com.streaming.launcher",
    "productName": "Streaming Launcher",
    "directories": {
      "output": "dist"
    },
    "files": [
      "main.js",
      "renderer.js",
      "index.html",
      "styles.css"
    ],
    "linux": {
      "target": "AppImage",
      "category": "AudioVideo"
    }
  }
}
