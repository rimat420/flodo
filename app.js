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
        directionText.textContent = 'Floridsdorf → Praterstern';
    } else {
        directionText.textContent = 'Praterstern → Floridsdorf';
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
    const allConnections = [];
    
    try {
        if (direction === 'forward') {
            // Forward: Floridsdorf → Praterstern (with Wien Mitte info)
            const connections = await fetchJourneys(STATIONS.FLORIDSDORF, STATIONS.PRATERSTERN);
            
            // For each connection, also fetch Wien Mitte arrival time
            for (const conn of connections) {
                // Try to get Wien Mitte arrival by checking the same train
                const wienMitteTime = await getIntermediateStopTime(conn, STATIONS.WIEN_MITTE);
                allConnections.push({
                    ...conn,
                    targetStation: 'Praterstern',
                    wienMitteArrival: wienMitteTime
                });
            }
        } else {
            // Reverse: Praterstern → Floridsdorf (with Wien Mitte info)
            const connections = await fetchJourneys(STATIONS.PRATERSTERN, STATIONS.FLORIDSDORF);
            
            // For each connection, also fetch Wien Mitte arrival time
            for (const conn of connections) {
                const wienMitteTime = await getIntermediateStopTime(conn, STATIONS.WIEN_MITTE);
                allConnections.push({
                    ...conn,
                    originStation: 'Praterstern',
                    targetStation: 'Floridsdorf',
                    wienMitteArrival: wienMitteTime
                });
            }
        }
    } catch (error) {
        console.error('Error fetching connections:', error);
    }
    
    // Sort by departure time and return top 5
    return allConnections
        .sort((a, b) => new Date(a.departure) - new Date(b.departure))
        .slice(0, 5);
}

// Helper function to get intermediate stop time
async function getIntermediateStopTime(connection, stationId) {
    try {
        // For forward direction: get journey from origin to Wien Mitte with same departure
        // For reverse direction: get journey from Wien Mitte to destination
        
        const depTime = new Date(connection.departure).toISOString();
        
        if (currentDirection === 'forward') {
            // Floridsdorf → Wien Mitte
            const url = `${API}/journeys?from=${connection.legs[0].origin.id}&to=${stationId}&departure=${depTime}&results=3`;
            const response = await fetch(url);
            const data = await response.json();
            
            if (data.journeys && data.journeys.length > 0) {
                // Find journey with matching train number
                const matchingJourney = data.journeys.find(j => 
                    j.legs[0].tripId === connection.legs[0].tripId ||
                    (j.legs[0].line && connection.legs[0].line && 
                     j.legs[0].line.name === connection.legs[0].line.name &&
                     Math.abs(new Date(j.legs[0].departure) - new Date(connection.departure)) < 60000)
                );
                
                if (matchingJourney) {
                    return matchingJourney.legs[matchingJourney.legs.length - 1].arrival;
                }
            }
        } else {
            // Praterstern → Wien Mitte → Floridsdorf
            // We need to check if the train stops at Wien Mitte
            const url = `${API}/journeys?from=${STATIONS.PRATERSTERN}&to=${STATIONS.WIEN_MITTE}&departure=${depTime}&results=3`;
            const response = await fetch(url);
            const data = await response.json();
            
            if (data.journeys && data.journeys.length > 0) {
                const matchingJourney = data.journeys.find(j => 
                    j.legs[0].tripId === connection.legs[0].tripId ||
                    (j.legs[0].line && connection.legs[0].line && 
                     j.legs[0].line.name === connection.legs[0].line.name &&
                     Math.abs(new Date(j.legs[0].departure) - new Date(connection.departure)) < 60000)
                );
                
                if (matchingJourney) {
                    return matchingJourney.legs[matchingJourney.legs.length - 1].arrival;
                }
            }
        }
    } catch (error) {
        console.error('Error fetching Wien Mitte time:', error);
    }
    
    return null;
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
    
    // Determine final destination
    const finalDestination = currentDirection === 'forward' ? 'Praterstern' : 'Floridsdorf';
    
    // Build arrival times HTML
    let arrivalTimesHTML = '';
    if (connection.wienMitteArrival) {
        arrivalTimesHTML = `
            <div class="arrival-time">Wien Mitte: ${formatTime(new Date(connection.wienMitteArrival))}</div>
            <div class="arrival-time">${finalDestination}: ${formatTime(arrTime)}</div>
        `;
    } else {
        arrivalTimesHTML = `<div class="arrival-time">${finalDestination}: ${formatTime(arrTime)}</div>`;
    }
    
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