class StreamingLauncherUI {
    constructor() {
        this.services = {};
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.startClock();
        this.loadServices();
    }

    setupEventListeners() {
        // Quit button
        document.getElementById('quit-btn').addEventListener('click', () => {
            window.electronAPI.quitApp();
        });

        // Settings button
        document.getElementById('settings-btn').addEventListener('click', () => {
            this.showSettings();
        });

        // Close settings
        document.getElementById('close-settings').addEventListener('click', () => {
            this.hideSettings();
        });

        // Settings modal backdrop click
        document.getElementById('settings-modal').addEventListener('click', (e) => {
            if (e.target.id === 'settings-modal') {
                this.hideSettings();
            }
        });

        // Settings checkboxes
        document.getElementById('show-time').addEventListener('change', (e) => {
            const timeDisplay = document.getElementById('time-display');
            timeDisplay.style.display = e.target.checked ? 'block' : 'none';
            localStorage.setItem('show-time', e.target.checked);
        });

        document.getElementById('large-tiles').addEventListener('change', (e) => {
            const grid = document.getElementById('services-grid');
            grid.classList.toggle('compact', !e.target.checked);
            localStorage.setItem('large-tiles', e.target.checked);
        });

        // Load settings
        this.loadSettings();

        // Listen for services data from main process
        window.electronAPI.onServicesData((event, services) => {
            this.services = services;
            this.renderServices();
        });
    }

    async loadServices() {
        try {
            this.services = await window.electronAPI.getServices();
            this.renderServices();
        } catch (error) {
            console.error('Failed to load services:', error);
        }
    }

    renderServices() {
        const grid = document.getElementById('services-grid');
        grid.innerHTML = '';

        Object.entries(this.services).forEach(([id, service]) => {
            const card = this.createServiceCard(id, service);
            grid.appendChild(card);
        });
    }

    createServiceCard(id, service) {
        const card = document.createElement('div');
        card.className = 'service-card';
        card.setAttribute('data-service', id);

        card.innerHTML = `
            <div class="service-icon">${service.icon}</div>
            <div class="service-name">${service.name}</div>
        `;

        card.addEventListener('click', () => this.launchService(id, card));
        
        return card;
    }

    async launchService(serviceId, cardElement) {
        try {
            // Add loading state
            cardElement.classList.add('loading');
            
            // Add haptic feedback (visual)
            cardElement.style.transform = 'scale(0.95)';
            setTimeout(() => {
                cardElement.style.transform = '';
            }, 150);

            // Launch the service
            await window.electronAPI.launchService(serviceId);
            
            // Note: The loading state will be removed when the app window becomes visible again
            // This happens automatically when the launched service closes
            
        } catch (error) {
            console.error(`Failed to launch service ${serviceId}:`, error);
            cardElement.classList.remove('loading');
            
            // Show error feedback
            this.showNotification(`Failed to launch ${this.services[serviceId].name}`, 'error');
        }
    }

    showSettings() {
        const modal = document.getElementById('settings-modal');
        modal.classList.add('show');
    }

    hideSettings() {
        const modal = document.getElementById('settings-modal');
        modal.classList.remove('show');
    }

    loadSettings() {
        // Load show-time setting
        const showTime = localStorage.getItem('show-time');
        if (showTime !== null) {
            const checkbox = document.getElementById('show-time');
            checkbox.checked = showTime === 'true';
            const timeDisplay = document.getElementById('time-display');
            timeDisplay.style.display = checkbox.checked ? 'block' : 'none';
        }

        // Load large-tiles setting
        const largeTiles = localStorage.getItem('large-tiles');
        if (largeTiles !== null) {
            const checkbox = document.getElementById('large-tiles');
            checkbox.checked = largeTiles === 'true';
            const grid = document.getElementById('services-grid');
            grid.classList.toggle('compact', !checkbox.checked);
        }
    }

    startClock() {
        const updateTime = () => {
            const now = new Date();
            const timeString = now.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            });
            const dateString = now.toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'short',
                day: 'numeric'
            });
            
            document.getElementById('time-display').innerHTML = `
                <div style="font-size: 1.5rem; font-weight: 300;">${timeString}</div>
                <div style="font-size: 1rem; opacity: 0.7;">${dateString}</div>
            `;
        };

        updateTime();
        setInterval(updateTime, 1000);
    }

    showNotification(message, type = 'info') {
        // Create a simple notification system
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        notification.style.cssText = `
            position: fixed;
            top: 2rem;
            right: 2rem;
            background: ${type === 'error' ? 'rgba(220, 38, 38, 0.9)' : 'rgba(34, 197, 94, 0.9)'};
            color: white;
            padding: 1rem 1.5rem;
            border-radius: 12px;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.2);
            z-index: 2000;
            animation: slideIn 0.3s ease;
            font-weight: 500;
        `;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease forwards';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }
}

// Add CSS animations for notifications
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

// Initialize the UI when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new StreamingLauncherUI();
});

// Handle window focus/blur for cleaning up loading states
window.addEventListener('focus', () => {
    // Remove loading states from all cards when window regains focus
    document.querySelectorAll('.service-card.loading').forEach(card => {
        card.classList.remove('loading');
    });
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    // ESC key to show settings or close modal
    if (e.key === 'Escape') {
        const modal = document.getElementById('settings-modal');
        if (modal.classList.contains('show')) {
            modal.classList.remove('show');
        } else {
            document.getElementById('settings-btn').click();
        }
    }
    
    // Ctrl+Q to quit
    if (e.ctrlKey && e.key === 'q') {
        e.preventDefault();
        window.electronAPI.quitApp();
    }
    
    // Number keys to launch services (1-8)
    if (e.key >= '1' && e.key <= '8') {
        const serviceIndex = parseInt(e.key) - 1;
        const cards = document.querySelectorAll('.service-card');
        if (cards[serviceIndex]) {
            cards[serviceIndex].click();
        }
    }
});
