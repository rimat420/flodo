// Configuration
const API = "https://v6.oebb.transport.rest";
const STATIONS = {
    FLORIDSDORF: "8103000",
    WIEN_MITTE: "8101059",
    PRATERSTERN: "8101039"
};

// Allowed transport types - expanded list
const ALLOWED_PRODUCTS = [
    'suburban',     // S-Bahn
    'regional',     // REX, R
    'subway',       // U-Bahn
    'nationalExp',  // ICE, RJ
    'national',     // IC, EC
    'citybus',      // Sometimes needed for connections
];

// App state
let currentDirection = 'forward';
let lastUpdate = null;
let updateInterval = null;

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    console.log('App initializing...');
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
    console.log('Direction updated to:', currentDirection);
}

// Load connections
async function loadConnections() {
    showLoading(true);
    console.log('Loading connections for direction:', currentDirection);
    
    try {
        const connections = await getConnections(currentDirection);
        displayConnections(connections);
        updateLastUpdateTime();
        hideError();
    } catch (error) {
        console.error('Error loading connections:', error);
        showError('Fehler beim Laden der Verbindungen: ' + error.message);
    } finally {
        showLoading(false);
    }
}

// Get connections from API
async function getConnections(direction = 'forward') {
    const allConnections = [];
    
    if (direction === 'forward') {
        // Forward: Floridsdorf to Wien Mitte/Praterstern
        console.log('Getting connections from Floridsdorf to Wien Mitte and Praterstern');
        
        // Try Wien Mitte
        try {
            const connections = await fetchJourneys(STATIONS.FLORIDSDORF, STATIONS.WIEN_MITTE);
            allConnections.push(...connections.map(c => ({
                ...c,
                targetStation: 'Wien Mitte'
            })));
        } catch (error) {
            console.error('Error fetching Floridsdorf → Wien Mitte:', error);
        }
        
        // Try Praterstern
        try {
            const connections = await fetchJourneys(STATIONS.FLORIDSDORF, STATIONS.PRATERSTERN);
            allConnections.push(...connections.map(c => ({
                ...c,
                targetStation: 'Praterstern'
            })));
        } catch (error) {
            console.error('Error fetching Floridsdorf → Praterstern:', error);
        }
    } else {
        // Reverse: Wien Mitte/Praterstern to Floridsdorf
        console.log('Getting connections from Wien Mitte and Praterstern to Floridsdorf');
        
        // Try from Wien Mitte
        try {
            const connections = await fetchJourneys(STATIONS.WIEN_MITTE, STATIONS.FLORIDSDORF);
            allConnections.push(...connections.map(c => ({
                ...c,
                originStation: 'Wien Mitte'
            })));
        } catch (error) {
            console.error('Error fetching Wien Mitte → Floridsdorf:', error);
        }
        
        // Try from Praterstern
        try {
            const connections = await fetchJourneys(STATIONS.PRATERSTERN, STATIONS.FLORIDSDORF);
            allConnections.push(...connections.map(c => ({
                ...c,
                originStation: 'Praterstern'
            })));
        } catch (error) {
            console.error('Error fetching Praterstern → Floridsdorf:', error);
        }
    }
    
    console.log(`Total connections found: ${allConnections.length}`);
    
    // Sort by departure time and return top 5
    return allConnections
        .sort((a, b) => new Date(a.departure) - new Date(b.departure))
        .slice(0, 5);
}

// Fetch journeys from API
async function fetchJourneys(from, to) {
    // Build URL with parameters
    const params = new URLSearchParams({
        from: from,
        to: to,
        results: '10',  // Get more results initially
        suburban: 'true',
        regional: 'true', 
        subway: 'true',
        nationalExp: 'true',
        national: 'true',
        bus: 'false',
        tram: 'false'
    });
    
    const url = `${API}/journeys?${params}`;
    
    console.log(`Fetching: ${getStationName(from)} → ${getStationName(to)}`);
    console.log('URL:', url);
    
    try {
        const response = await fetch(url);
        console.log('Response status:', response.status);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('API Error Response:', errorText);
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }
        
        const data = await response.json();
        console.log('API Response:', {
            journeys: data.journeys?.length || 0,
            earlierRef: data.earlierRef,
            laterRef: data.laterRef
        });
        
        if (!data.journeys || data.journeys.length === 0) {
            console.warn('No journeys in response');
            return [];
        }
        
        // Log first journey for debugging
        if (data.journeys[0]) {
            console.log('First journey example:', {
                legs: data.journeys[0].legs.map(leg => ({
                    line: leg.line?.name,
                    product: leg.line?.product,
                    from: leg.origin?.name,
                    to: leg.destination?.name
                }))
            });
        }
        
        // Filter and process journeys
        const filtered = data.journeys.filter(journey => {
            // Must have at least one non-walking leg
            const hasTransport = journey.legs.some(leg => !leg.walking && leg.line);
            
            // Check if journey uses allowed products
            const usesAllowedProducts = journey.legs.every(leg => {
                if (leg.walking) return true;
                if (!leg.line || !leg.line.product) {
                    console.log('Leg without product:', leg);
                    return false;
                }
                
                const isAllowed = ALLOWED_PRODUCTS.includes(leg.line.product);
                if (!isAllowed) {
                    console.log(`Filtered out: ${leg.line.product} (${leg.line.name})`);
                }
                return isAllowed;
            });
            
            return hasTransport && usesAllowedProducts;
        });
        
        console.log(`Filtered ${data.journeys.length} → ${filtered.length} journeys`);
        
        return filtered.map(journey => ({
            departure: journey.legs[0].departure,
            arrival: journey.legs[journey.legs.length - 1].arrival,
            duration: calculateDuration(journey.legs[0].departure, journey.legs[journey.legs.length - 1].arrival),
            transfers: journey.legs.filter(leg => !leg.walking).length - 1,
            legs: journey.legs.filter(leg => !leg.walking).map(leg => ({
                departure: leg.departure,
                arrival: leg.arrival,
                line: {
                    name: leg.line.name,
                    product: leg.line.product,
                    direction: leg.direction
                },
                platform: leg.departurePlatform || leg.plannedDeparturePlatform,
                delay: leg.departureDelay
            }))
        }));
    } catch (error) {
        console.error('Fetch error:', error);
        throw error;
    }
}

// Get station name for logging
function getStationName(id) {
    const names = {
        "8103000": "Floridsdorf",
        "8101059": "Wien Mitte",
        "8101039": "Praterstern"
    };
    return names[id] || id;
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
                <span class="platform">${firstLeg.platform ? `Gleis ${firstLeg.platform}` : ''}</span>
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
        case 'regional':
        case 'regionalExp': return 'rex';
        case 'subway': return 'ubahn';
        case 'national':
        case 'nationalExp': return 'rex';
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