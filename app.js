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
    
    // Auto-refresh every 90 seconds
    updateInterval = setInterval(loadConnections, 90000);
    
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
        directionText.textContent = 'Floridsdorf → Wien Mitte';
    } else {
        directionText.textContent = 'Wien Mitte → Floridsdorf';
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
    const connections = new Map(); // Use Map to group by train
    
    try {
        if (direction === 'forward') {
            // Forward: Floridsdorf → Wien Mitte (with Praterstern as intermediate)
            // Add small delay between API calls to avoid rate limiting
            const mitteConnections = await fetchJourneys(STATIONS.FLORIDSDORF, STATIONS.WIEN_MITTE);
            await new Promise(resolve => setTimeout(resolve, 200)); // 200ms delay
            const pratersternConnections = await fetchJourneys(STATIONS.FLORIDSDORF, STATIONS.PRATERSTERN);
            
            // Use Wien Mitte connections as base
            mitteConnections.forEach(conn => {
                const key = `${conn.departure}_${conn.legs[0].line?.name || ''}`;
                connections.set(key, {
                    ...conn,
                    wienMitteArrival: conn.arrival,
                    pratersternArrival: null
                });
            });
            
            // Add Praterstern arrival times
            pratersternConnections.forEach(conn => {
                const key = `${conn.departure}_${conn.legs[0].line?.name || ''}`;
                if (connections.has(key)) {
                    connections.get(key).pratersternArrival = conn.arrival;
                }
            });
            
        } else {
            // Reverse: Wien Mitte → Floridsdorf (with Praterstern as intermediate)
            const floridsdorfConnections = await fetchJourneys(STATIONS.WIEN_MITTE, STATIONS.FLORIDSDORF);
            await new Promise(resolve => setTimeout(resolve, 200)); // 200ms delay
            const pratersternConnections = await fetchJourneys(STATIONS.WIEN_MITTE, STATIONS.PRATERSTERN);
            
            // Use Floridsdorf connections as base
            floridsdorfConnections.forEach(conn => {
                const key = `${conn.departure}_${conn.legs[0].line?.name || ''}`;
                connections.set(key, {
                    ...conn,
                    floridsdorfArrival: conn.arrival,
                    pratersternArrival: null
                });
            });
            
            // Add Praterstern arrival times
            pratersternConnections.forEach(conn => {
                const key = `${conn.departure}_${conn.legs[0].line?.name || ''}`;
                if (connections.has(key)) {
                    connections.get(key).pratersternArrival = conn.arrival;
                }
            });
        }
        
        // Log what we found
        console.log(`Direction: ${direction}, found ${connections.size} connections`);
        
    } catch (error) {
        console.error('Error fetching connections:', error);
    }
    
    // Convert Map to array, sort by departure time and return top 5
    return Array.from(connections.values())
        .sort((a, b) => new Date(a.departure) - new Date(b.departure))
        .slice(0, 5);
}

// Fetch journeys from API with retry logic
async function fetchJourneys(from, to, retries = 2) {
    const url = `${API}/journeys?from=${from}&to=${to}&results=5&suburban=true&regional=true&subway=true&bus=false&tram=false`;
    
    for (let i = 0; i <= retries; i++) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            // Check if we got valid data
            if (!data.journeys || !Array.isArray(data.journeys)) {
                console.warn(`No journeys array in response from ${from} to ${to}`);
                if (i < retries) {
                    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
                    continue;
                }
                return [];
            }
            
            // Filter and process journeys
            const filtered = data.journeys
                .filter(journey => {
                    // Must have legs
                    if (!journey.legs || journey.legs.length === 0) return false;
                    
                    // Check if all legs use allowed transport types
                    return journey.legs.every(leg => {
                        if (leg.walking) return true; // Walking is OK
                        if (!leg.line || !leg.line.product) return false;
                        return ALLOWED_PRODUCTS.includes(leg.line.product);
                    });
                });
            
            console.log(`Found ${filtered.length} valid journeys from ${from} to ${to}`);
            
            return filtered.map(journey => {
                // Log first leg to check available data
                if (filtered.length > 0 && journey === filtered[0]) {
                    console.log('Journey details:', {
                        line: journey.legs[0].line,
                        direction: journey.legs[0].direction,
                        destination: journey.legs[0].destination
                    });
                }
                
                return {
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
                        delay: leg.departureDelay,
                        direction: leg.direction, // Add direction field
                        destination: leg.destination // Add destination field
                    }))
                };
            });
            
        } catch (error) {
            console.error(`API Error (attempt ${i + 1}/${retries + 1}):`, error);
            if (i < retries) {
                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait before retry
            }
        }
    }
    
    return []; // Return empty array if all retries failed
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
    const firstLeg = connection.legs[0];
    
    // Get delay info
    const delay = firstLeg.delay ? Math.round(firstLeg.delay / 60) : 0;
    const delayText = delay > 0 ? `<span class="delay">+${delay}</span>` : '';
    
    // Get train direction (end destination)
    const trainDirection = firstLeg.direction || firstLeg.line?.direction || 'Unbekannt';
    
    // Build arrival times HTML with correct chronological order
    let arrivalTimesHTML = '';
    
    if (currentDirection === 'forward') {
        // Forward: Floridsdorf → Praterstern → Wien Mitte
        if (connection.pratersternArrival) {
            arrivalTimesHTML += `<div class="arrival-time">Praterstern: ${formatTime(new Date(connection.pratersternArrival))}</div>`;
        }
        if (connection.wienMitteArrival) {
            arrivalTimesHTML += `<div class="arrival-time">Wien Mitte: ${formatTime(new Date(connection.wienMitteArrival))}</div>`;
        }
    } else {
        // Reverse: Wien Mitte → Praterstern → Floridsdorf
        if (connection.pratersternArrival) {
            arrivalTimesHTML += `<div class="arrival-time">Praterstern: ${formatTime(new Date(connection.pratersternArrival))}</div>`;
        }
        if (connection.floridsdorfArrival) {
            arrivalTimesHTML += `<div class="arrival-time">Floridsdorf: ${formatTime(new Date(connection.floridsdorfArrival))}</div>`;
        }
    }
    
    div.innerHTML = `
        <div class="connection-header">
            <div class="departure-time">
                ${formatTime(depTime)}
                ${delayText}
            </div>
            <div class="train-line">
                <span class="train-type ${getProductClass(firstLeg.line.product)}">${firstLeg.line.name}</span>
            </div>
            <div class="train-direction">${trainDirection}</div>
        </div>
        <div class="connection-details">
            <div class="platform">Gleis ${firstLeg.platform || '?'}</div>
            ${arrivalTimesHTML}
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