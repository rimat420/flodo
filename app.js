// Configuration
const API = "https://oebb.macistry.com/api";
const STATIONS = {
    FLORIDSDORF: "1192101",
    WIEN_MITTE: "1290302",
    PRATERSTERN: "1290201"
};

// Allowed transport types (S-Bahn, REX, U-Bahn only)
const ALLOWED_PRODUCTS = ['suburban', 'regional', 'subway'];

// App state
let currentDirection = 'forward';
let lastUpdate = null;
let updateInterval = null;

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
    loadConnections();
    
    // Auto-refresh every 30 seconds
    updateInterval = setInterval(loadConnections, 30000);
    
    // Event listeners
    document.getElementById('refresh').addEventListener('click', () => {
        loadConnections();
    });
    
    document.getElementById('switchDirection').addEventListener('click', () => {
        switchDirection();
    });
});

// Initialize app settings
function initializeApp() {
    // Load saved direction
    const savedDirection = localStorage.getItem('direction');
    if (savedDirection) {
        currentDirection = savedDirection;
    }
    updateDirectionDisplay();
}

// Switch travel direction
function switchDirection() {
    currentDirection = currentDirection === 'forward' ? 'reverse' : 'forward';
    localStorage.setItem('direction', currentDirection);
    updateDirectionDisplay();
    loadConnections();
}

// Update direction display
function updateDirectionDisplay() {
    const directionText = document.querySelector('.direction-text');
    if (currentDirection === 'forward') {
        directionText.textContent = 'Floridsdorf → Wien Mitte/Praterstern';
    } else {
        directionText.textContent = 'Wien Mitte/Praterstern → Floridsdorf';
    }
}

// Load connections
async function loadConnections() {
    showLoading(true);
    
    try {
        const connections = await getConnections(currentDirection);
        displayConnections(connections);
        updateLastUpdateTime();
        hideError();
    } catch (error) {
        showError('Fehler beim Laden der Verbindungen: ' + error.message);
    } finally {
        showLoading(false);
    }
}

// Get connections from API
async function getConnections(direction = 'forward') {
    let origin, destinations;
    
    if (direction === 'forward') {
        origin = STATIONS.FLORIDSDORF;
        destinations = [STATIONS.WIEN_MITTE, STATIONS.PRATERSTERN];
    } else {
        // For reverse, try both as origin
        origin = null;
        destinations = [STATIONS.FLORIDSDORF];
    }
    
    const allConnections = [];
    
    if (direction === 'forward') {
        // Get journeys to all destinations
        for (const dest of destinations) {
            try {
                const connections = await fetchJourneys(origin, dest);
                allConnections.push(...connections.map(c => ({
                    ...c,
                    targetStation: dest === STATIONS.WIEN_MITTE ? 'Wien Mitte' : 'Praterstern'
                })));
            } catch (error) {
                console.error(`Error fetching ${origin} to ${dest}:`, error);
            }
        }
    } else {
        // For reverse direction, try from both stations
        const origins = [STATIONS.WIEN_MITTE, STATIONS.PRATERSTERN];
        for (const org of origins) {
            try {
                const connections = await fetchJourneys(org, STATIONS.FLORIDSDORF);
                allConnections.push(...connections.map(c => ({
                    ...c,
                    originStation: org === STATIONS.WIEN_MITTE ? 'Wien Mitte' : 'Praterstern'
                })));
            } catch (error) {
                console.error(`Error fetching ${org} to Floridsdorf:`, error);
            }
        }
    }
    
    // Sort by departure time and return top 5
    return allConnections
        .sort((a, b) => new Date(a.departure) - new Date(b.departure))
        .slice(0, 5);
}

// Fetch journeys from API
async function fetchJourneys(from, to) {
    const url = `${API}/journeys?from=${from}&to=${to}&results=5&suburban=true&regional=true&subway=true&bus=false&tram=false`;
    
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        
        // Filter and process journeys
        return data.journeys
            .filter(journey => {
                // Check if all legs use allowed transport types
                return journey.legs.every(leg => {
                    if (leg.walking) return true; // Walking is OK
                    if (!leg.line || !leg.line.product) return false;
                    return ALLOWED_PRODUCTS.includes(leg.line.product);
                });
            })
            .map(journey => ({
                departure: journey.legs[0].departure,
                arrival: journey.legs[journey.legs.length - 1].arrival,
                duration: calculateDuration(journey.legs[0].departure, journey.legs[journey.legs.length - 1].arrival),
                transfers: journey.legs.length - 1,
                legs: journey.legs.map(leg => ({
                    departure: leg.departure,
                    arrival: leg.arrival,
                    line: leg.line ? {
                        name: leg.line.name,
                        product: leg.line.product,
                        direction: leg.direction
                    } : null,
                    platform: leg.departurePlatform,
                    delay: leg.departureDelay
                }))
            }));
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
}

// Calculate duration in minutes
function calculateDuration(departure, arrival) {
    const dep = new Date(departure);
    const arr = new Date(arrival);
    return Math.round((arr - dep) / 60000);
}

// Display connections
function displayConnections(connections) {
    const container = document.getElementById('connections');
    container.innerHTML = '';
    
    if (connections.length === 0) {
        container.innerHTML = '<div class="no-connections">Keine Verbindungen gefunden</div>';
        return;
    }
    
    connections.forEach(connection => {
        const connectionEl = createConnectionElement(connection);
        container.appendChild(connectionEl);
    });
}

// Create connection element
function createConnectionElement(connection) {
    const div = document.createElement('div');
    div.className = 'connection';
    
    const depTime = new Date(connection.departure);
    const arrTime = new Date(connection.arrival);
    const firstLeg = connection.legs[0];
    
    // Get delay info
    const delay = firstLeg.delay ? Math.round(firstLeg.delay / 60) : 0;
    const delayText = delay > 0 ? `<span class="delay">+${delay}</span>` : '';
    
    // Determine destination/origin text
    const stationText = connection.targetStation || connection.originStation || '';
    
    div.innerHTML = `
        <div class="connection-header">
            <div>
                <span class="departure-time">${formatTime(depTime)}</span>
                ${delayText}
            </div>
            <div class="duration">${connection.duration} Min.</div>
        </div>
        <div class="connection-details">
            <div class="train-info">
                <span class="train-type ${getProductClass(firstLeg.line.product)}">${firstLeg.line.name}</span>
                <span class="platform">Gleis ${firstLeg.platform || '?'}</span>
            </div>
            <div class="arrival-time">
                Ankunft ${formatTime(arrTime)} ${stationText ? `(${stationText})` : ''}
            </div>
            ${connection.transfers > 0 ? `<div class="transfers">${connection.transfers} Umstieg${connection.transfers > 1 ? 'e' : ''}</div>` : ''}
        </div>
    `;
    
    return div;
}

// Get CSS class for product type
function getProductClass(product) {
    switch(product) {
        case 'suburban': return 'sbahn';
        case 'regional': return 'rex';
        case 'subway': return 'ubahn';
        default: return '';
    }
}

// Format time
function formatTime(date) {
    return date.toLocaleTimeString('de-AT', { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
}

// Update last update time
function updateLastUpdateTime() {
    lastUpdate = new Date();
    document.getElementById('lastUpdate').textContent = 
        `Aktualisiert: ${formatTime(lastUpdate)}`;
}

// Show/hide loading
function showLoading(show) {
    document.getElementById('loading').classList.toggle('hidden', !show);
    document.getElementById('connections').classList.toggle('hidden', show);
    
    const refreshBtn = document.getElementById('refresh');
    refreshBtn.classList.toggle('rotating', show);
}

// Show error
function showError(message) {
    const errorEl = document.getElementById('error');
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
}

// Hide error
function hideError() {
    document.getElementById('error').classList.add('hidden');
}

// Handle visibility change (for auto-refresh)
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        loadConnections();
    }
});

// Service Worker registration for offline support
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => {
        console.log('ServiceWorker registration failed:', err);
    });
}