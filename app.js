// Configuration
const API = "https://oebb.macistry.com/api";
const STATIONS = {
    FLORIDSDORF: "1292101",
    WIEN_MITTE: "1290302",
    PRATERSTERN: "1290201",
    TRAISENGASSE: "1292002"
};

// Route configurations
const ROUTES = {
    'f-m': { from: 'FLORIDSDORF', to: 'WIEN_MITTE', label: 'F → M' },
    'm-f': { from: 'WIEN_MITTE', to: 'FLORIDSDORF', label: 'M → F' },
    'p-f': { from: 'PRATERSTERN', to: 'FLORIDSDORF', label: 'P → F' },
    't-f': { from: 'TRAISENGASSE', to: 'FLORIDSDORF', label: 'T → F' }
};

// Allowed transport types (S-Bahn, REX only)
const ALLOWED_PRODUCTS = ['suburban', 'regional'];

// App state
let currentRoute = 'f-m';
let lastUpdate = null;
let updateInterval = null;

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
    createRouteButtons();
    loadConnections();
    
    // Auto-refresh every 3 minutes (instead of 90 seconds)
    updateInterval = setInterval(loadConnections, 180000);
    
    // Event listeners
    document.getElementById('refresh').addEventListener('click', () => {
        // Add cooldown to manual refresh
        const refreshBtn = document.getElementById('refresh');
        if (refreshBtn.disabled) return;
        
        refreshBtn.disabled = true;
        setTimeout(() => {
            refreshBtn.disabled = false;
        }, 5000); // 5 second cooldown
        
        loadConnections();
    });
});

// Initialize app settings
function initializeApp() {
    // Load saved route
    const savedRoute = localStorage.getItem('route');
    if (savedRoute && ROUTES[savedRoute]) {
        currentRoute = savedRoute;
    }
}

// Create route selection buttons
function createRouteButtons() {
    const container = document.querySelector('.route-buttons');
    
    Object.entries(ROUTES).forEach(([key, route]) => {
        const button = document.createElement('button');
        button.className = 'route-btn';
        button.dataset.route = key;
        button.textContent = route.label;
        
        if (key === currentRoute) {
            button.classList.add('active');
        }
        
        button.addEventListener('click', () => selectRoute(key));
        container.appendChild(button);
    });
}

// Select a route
function selectRoute(routeKey) {
    if (currentRoute === routeKey) return;
    
    currentRoute = routeKey;
    localStorage.setItem('route', routeKey);
    
    // Update button states
    document.querySelectorAll('.route-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.route === routeKey);
    });
    
    loadConnections();
}

// Load connections
async function loadConnections() {
    showLoading(true);
    
    try {
        const connections = await getConnections();
        
        if (connections.length > 0) {
            displayConnections(connections);
            updateLastUpdateTime();
            hideError();
            updateConnectionStatus('online');
        } else {
            // No connections found, but API worked
            displayConnections([]);
            updateLastUpdateTime();
            updateConnectionStatus('online');
            console.warn('No connections returned by API');
        }
    } catch (error) {
        console.error('LoadConnections error:', error);
        showError('Fehler beim Laden der Verbindungen: ' + error.message);
        updateConnectionStatus('offline');
        
        // Show cached data if available
        const cachedConnections = getCachedConnections();
        if (cachedConnections.length > 0) {
            displayConnections(cachedConnections);
            showError('Offline - zeige gespeicherte Daten');
        }
    } finally {
        showLoading(false);
    }
}

// Simple cache mechanism
function cacheConnections(connections) {
    try {
        localStorage.setItem(`connections_${currentRoute}`, JSON.stringify({
            data: connections,
            timestamp: Date.now()
        }));
    } catch (e) {
        console.error('Cache error:', e);
    }
}

function getCachedConnections() {
    try {
        const cached = localStorage.getItem(`connections_${currentRoute}`);
        if (cached) {
            const { data, timestamp } = JSON.parse(cached);
            // Use cache if less than 5 minutes old
            if (Date.now() - timestamp < 5 * 60 * 1000) {
                return data;
            }
        }
    } catch (e) {
        console.error('Cache retrieval error:', e);
    }
    return [];
}

// Get connections from API
async function getConnections() {
    try {
        const route = ROUTES[currentRoute];
        const from = STATIONS[route.from];
        const to = STATIONS[route.to];
        
        const connections = await fetchJourneys(from, to);
        
        console.log(`Route: ${route.label}, found ${connections.length} connections`);
        
        return connections;
        
    } catch (error) {
        console.error('Error fetching connections:', error);
        return [];
    }
}

// Fetch journeys from API with retry logic
async function fetchJourneys(from, to, retries = 2) {
    // Simplified URL without potentially problematic parameters
    const url = `${API}/journeys?from=${from}&to=${to}&results=5`;
    
    console.log(`Fetching journeys: ${from} -> ${to}`);
    console.log(`URL: ${url}`);
    
    for (let i = 0; i <= retries; i++) {
        try {
            const response = await fetch(url);
            
            console.log(`API Response status: ${response.status}`);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error(`HTTP Error ${response.status}: ${errorText}`);
                
                // If we get a 502 with ENUM error, it might be the product filters
                if (response.status === 502 && errorText.includes('ENUM')) {
                    console.warn('API ENUM error - trying without product filters');
                }
                
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            console.log('API Response:', data);
            
            // Check if we got valid data
            if (!data.journeys || !Array.isArray(data.journeys)) {
                console.warn(`No journeys array in response from ${from} to ${to}`);
                if (data.error) {
                    console.error('API Error:', data.error);
                }
                if (i < retries) {
                    console.log(`Retrying in 2 seconds... (attempt ${i + 1}/${retries + 1})`);
                    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds before retry
                    continue;
                }
                return [];
            }
            
            console.log(`Raw journeys count: ${data.journeys.length}`);

            // Filter and process journeys - now done after API call
            const filtered = data.journeys
                .filter((journey, index) => {
                    console.log(`\n=== Journey ${index + 1} ===`);

                    // Must have legs
                    if (!journey.legs || journey.legs.length === 0) {
                        console.log(`❌ FILTERED: No legs found`);
                        return false;
                    }

                    console.log(`Legs count: ${journey.legs.length}`);

                    // Log all legs to see structure
                    journey.legs.forEach((leg, legIndex) => {
                        console.log(`  Leg ${legIndex + 1}:`, {
                            line: leg.line?.name || 'NO LINE',
                            product: leg.line?.product || 'NO PRODUCT',
                            direction: leg.direction,
                            departure: leg.departure,
                            arrival: leg.arrival
                        });
                    });

                    // First leg must be S-Bahn or Regional train (no walking!)
                    const firstLeg = journey.legs[0];
                    if (!firstLeg.line || !firstLeg.line.product) {
                        console.log(`❌ FILTERED: First leg has no line or product`);
                        console.log(`  firstLeg.line:`, firstLeg.line);
                        return false;
                    }

                    const product = firstLeg.line.product;
                    if (!ALLOWED_PRODUCTS.includes(product)) {
                        console.log(`❌ FILTERED: Product "${product}" not in allowed list [${ALLOWED_PRODUCTS.join(', ')}]`);
                        return false;
                    }

                    console.log(`✅ ACCEPTED: ${firstLeg.line.name} (${product})`);
                    return true;
                });

            console.log(`\n📊 Summary: Found ${filtered.length} valid journeys after filtering (from ${data.journeys.length} total)`);
            
            const clean = (s) => s
                ?.replace(/[-\s]?\b(bahnhof|station|Wien|hbf|Bahnhst|Hippersdorf|Reichenau an der Rax|im\s+Weinviertel)\b/gi, "")
                .replace(/\s+/g, " ")
                .trim();

            const cleanLineName = (s) =>
                s?.replace(/\s*\(.*/, "").trim();

            const processedJourneys = filtered.map(journey => {
                // Find the main transport leg (not walking)
                const mainLeg = journey.legs.find(leg => leg.line && leg.line.product) || journey.legs[0];
                
                return {
                    departure: journey.legs[0].departure,
                    arrival: journey.legs[journey.legs.length - 1].arrival,
                    duration: calculateDuration(journey.legs[0].departure, journey.legs[journey.legs.length - 1].arrival),
                    transfers: journey.legs.length - 1,
                    legs: journey.legs.map(leg => ({
                        departure: leg.departure,
                        arrival: leg.arrival,
                        line: leg.line ? {
                            name: cleanLineName(leg.line.name),
                            product: leg.line.product,
                            direction: leg.direction
                        } : null,
                        platform: leg.departurePlatform || leg.platform,
                        delay: leg.departureDelay,
                        direction: clean(leg.direction),
                        destination: leg.destination
                    }))
                };
            });
            
            // Success - return the journeys
            return processedJourneys;
            
        } catch (error) {
            console.error(`API Error (attempt ${i + 1}/${retries + 1}):`, error);
            
            if (error.message.includes('fetch')) {
                console.error('Network error - check internet connection');
            }
            
            if (i < retries) {
                console.log(`Waiting 3 seconds before retry...`);
                await new Promise(resolve => setTimeout(resolve, 3000)); // Wait longer before retry
            } else {
                // Final attempt failed
                console.error('All retry attempts failed');
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
    
    // Cache successful connections
    if (connections.length > 0) {
        cacheConnections(connections);
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

    // Calculate time until departure
    const now = new Date();
    const minutesUntil = Math.round((depTime - now) / 60000);
    const timeUntilText = minutesUntil >= 0 ? `in ${minutesUntil} Min` : `vor ${-minutesUntil} Min`;

    // Get train direction (end destination)
    const trainDirection = firstLeg.direction || firstLeg.line?.direction || '';

    div.innerHTML = `
        <div class="connection-header">
            <div class="left-section">
                <div class="departure-time">
                    ${formatTime(depTime)}
                    ${delayText}
                </div>
                <div class="platform">Gleis ${firstLeg.platform || '?'}</div>
                <div class="time-until">${timeUntilText}</div>
            </div>
            <div class="middle-section">
                <div class="train-line">
                    <span class="train-type ${getProductClass(firstLeg.line.product)}">${firstLeg.line.name}</span>
                </div>
            </div>
            <div class="right-section">
                <div class="train-direction">${trainDirection}</div>
                <div class="arrival-time">${formatTime(arrTime)}</div>
                <div class="duration">${connection.duration} Min</div>
            </div>
        </div>
    `;

    return div;
}

// Get CSS class for product type
function getProductClass(product) {
    switch(product) {
        case 'suburban': return 'sbahn';
        case 'regional': return 'rex';
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
    const timestamp = new Date().toLocaleTimeString('de-AT');
    errorEl.innerHTML = `
        <div>${message}</div>
        <div style="font-size: 12px; margin-top: 5px; color: #999;">
            ${timestamp} - Bitte Browser-Konsole für Details prüfen
        </div>
    `;
    errorEl.classList.remove('hidden');
}

// Hide error
function hideError() {
    document.getElementById('error').classList.add('hidden');
}

// Add connection status indicator
function updateConnectionStatus(status) {
    const container = document.querySelector('.container');
    let statusEl = document.getElementById('connection-status');
    
    if (!statusEl) {
        statusEl = document.createElement('div');
        statusEl.id = 'connection-status';
        statusEl.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: ${status === 'online' ? '#0f0' : '#f00'};
            box-shadow: 0 0 5px rgba(0,0,0,0.5);
        `;
        container.appendChild(statusEl);
    } else {
        statusEl.style.background = status === 'online' ? '#0f0' : '#f00';
    }
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