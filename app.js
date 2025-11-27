// Configuration
const API = "https://oebb.macistry.com/api";
const STATIONS = {
    FLORIDSDORF: "1192101",
    WIEN_MITTE: "1290302",
    PRATERSTERN: "1290201"
};

// Wiener Linien station IDs (diva codes)
const WL_STATIONS = {
    FLORIDSDORF_U6: "60200334",
    SPITTELAU_U4: "60200230",
    SPITTELAU_U6: "60200657",
    PRATERSTERN_U1: "60200040",
    WIEN_MITTE_U4: "60200078",
    KARLSPLATZ_U4: "60200068",
    KARLSPLATZ_U1: "60200141"
};

// Allowed transport types (S-Bahn, REX, U-Bahn only)
const ALLOWED_PRODUCTS = ['suburban', 'regional', 'subway'];

// U-Bahn line configurations
const UBAHN_LINES = {
    U1: { color: '#e20a16', directions: { praterstern: 'Oberlaa', karlsplatz: 'Leopoldau' }},
    U4: { color: '#00963f', directions: { spittelau: 'Hütteldorf', karlsplatz: 'Heiligenstadt' }},
    U6: { color: '#9c6830', directions: { floridsdorf: 'Siebenhirten', spittelau: 'Floridsdorf' }}
};

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
        directionText.textContent = 'Floridsdorf → Karlsplatz';
    } else {
        directionText.textContent = 'Karlsplatz → Floridsdorf';
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

// Fetch U-Bahn departures from Wiener Linien
async function fetchUBahnDepartures(stationId, lineId, towards) {
    // Using a CORS proxy for Wiener Linien API
    const proxyUrl = 'https://corsproxy.io/?';
    const wlUrl = `https://www.wienerlinien.at/ogd_realtime/monitor?diva=${stationId}`;
    
    try {
        const response = await fetch(proxyUrl + encodeURIComponent(wlUrl));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const data = await response.json();
        
        // Extract relevant departures
        const departures = [];
        if (data.data && data.data.monitors) {
            data.data.monitors.forEach(monitor => {
                if (monitor.lines) {
                    monitor.lines.forEach(line => {
                        if (line.name === lineId && line.towards === towards) {
                            line.departures?.departure?.forEach(dep => {
                                if (dep.departureTime?.countdown !== undefined) {
                                    departures.push({
                                        countdown: dep.departureTime.countdown,
                                        timePlanned: dep.departureTime.timePlanned
                                    });
                                }
                            });
                        }
                    });
                }
            });
        }
        
        // Sort by countdown and return top 3
        return departures
            .sort((a, b) => a.countdown - b.countdown)
            .slice(0, 3)
            .map(dep => {
                // Convert to time format
                const time = new Date(dep.timePlanned);
                return formatTime(time);
            });
            
    } catch (error) {
        console.error(`Error fetching U-Bahn data for station ${stationId}:`, error);
        return [];
    }
}

// Calculate U-Bahn travel times (rough estimates in minutes)
const UBAHN_TRAVEL_TIMES = {
    'floridsdorf-spittelau': 13,
    'spittelau-karlsplatz': 10,
    'praterstern-karlsplatz': 6,
    'wienMitte-karlsplatz': 5
};

// Calculate U-Bahn arrival time including transfer
function calculateUBahnArrival(trainArrival, transferTime, travelTime) {
    const arrival = new Date(trainArrival);
    arrival.setMinutes(arrival.getMinutes() + transferTime + travelTime);
    return formatTime(arrival);
}

// Get connections from API
async function getConnections(direction = 'forward') {
    const connections = new Map(); // Use Map to group by train
    
    try {
        if (direction === 'forward') {
            // Forward: Floridsdorf → Karlsplatz
            // Add small delay between API calls to avoid rate limiting
            const mitteConnections = await fetchJourneys(STATIONS.FLORIDSDORF, STATIONS.WIEN_MITTE);
            await new Promise(resolve => setTimeout(resolve, 200)); // 200ms delay
            const pratersternConnections = await fetchJourneys(STATIONS.FLORIDSDORF, STATIONS.PRATERSTERN);
            
            // Fetch U-Bahn departures for forward direction
            const [u6Floridsdorf, u1Praterstern, u4WienMitte] = await Promise.all([
                fetchUBahnDepartures(WL_STATIONS.FLORIDSDORF_U6, 'U6', 'Siebenhirten'),
                fetchUBahnDepartures(WL_STATIONS.PRATERSTERN_U1, 'U1', 'Oberlaa'),
                fetchUBahnDepartures(WL_STATIONS.WIEN_MITTE_U4, 'U4', 'Hütteldorf')
            ]);
            
            // Use Wien Mitte connections as base
            mitteConnections.forEach(conn => {
                const key = `${conn.departure}_${conn.legs[0].line?.name || ''}`;
                connections.set(key, {
                    ...conn,
                    wienMitteArrival: conn.arrival,
                    pratersternArrival: null,
                    ubahnConnections: {
                        wienMitte: {
                            arrival: conn.arrival,
                            nextU4: u4WienMitte,
                            karlsplatzArrival: calculateUBahnArrival(conn.arrival, 5, 5)
                        }
                    }
                });
            });
            
            // Add Praterstern arrival times and U-Bahn connections
            pratersternConnections.forEach(conn => {
                const key = `${conn.departure}_${conn.legs[0].line?.name || ''}`;
                if (connections.has(key)) {
                    const connection = connections.get(key);
                    connection.pratersternArrival = conn.arrival;
                    connection.ubahnConnections.praterstern = {
                        arrival: conn.arrival,
                        nextU1: u1Praterstern,
                        karlsplatzArrival: calculateUBahnArrival(conn.arrival, 5, 6)
                    };
                }
            });
            
            // Add direct U6 connection
            if (u6Floridsdorf.length > 0) {
                const u4Spittelau = await fetchUBahnDepartures(WL_STATIONS.SPITTELAU_U4, 'U4', 'Hütteldorf');
                
                const now = new Date();
                const u6Time = u6Floridsdorf[0].split(':');
                const u6Departure = new Date(now);
                u6Departure.setHours(parseInt(u6Time[0]), parseInt(u6Time[1]), 0, 0);
                
                // If departure is in the past, assume it's tomorrow
                if (u6Departure < now) {
                    u6Departure.setDate(u6Departure.getDate() + 1);
                }
                
                const spittelauArrival = new Date(u6Departure.getTime() + UBAHN_TRAVEL_TIMES['floridsdorf-spittelau'] * 60000);
                
                const u6Connection = {
                    departure: u6Departure.toISOString(),
                    arrival: spittelauArrival.toISOString(),
                    duration: UBAHN_TRAVEL_TIMES['floridsdorf-spittelau'] + 5 + UBAHN_TRAVEL_TIMES['spittelau-karlsplatz'],
                    transfers: 1,
                    isUBahn: true,
                    legs: [{
                        departure: u6Departure.toISOString(),
                        arrival: spittelauArrival.toISOString(),
                        line: { name: 'U6', product: 'subway' },
                        platform: null,
                        delay: 0,
                        direction: 'Siebenhirten'
                    }],
                    ubahnConnections: {
                        spittelau: {
                            arrival: spittelauArrival.toISOString(),
                            nextU4: u4Spittelau,
                            karlsplatzArrival: calculateUBahnArrival(spittelauArrival.toISOString(), 5, UBAHN_TRAVEL_TIMES['spittelau-karlsplatz'])
                        }
                    }
                };
                
                connections.set(`u6_direct_${u6Departure.getTime()}`, u6Connection);
            }
            
        } else {
            // Reverse: Karlsplatz → Floridsdorf
            const floridsdorfConnections = await fetchJourneys(STATIONS.WIEN_MITTE, STATIONS.FLORIDSDORF);
            await new Promise(resolve => setTimeout(resolve, 200)); // 200ms delay
            const pratersternConnections = await fetchJourneys(STATIONS.WIEN_MITTE, STATIONS.PRATERSTERN);
            
            // Fetch U-Bahn departures for reverse direction
            const [u4Karlsplatz, u1Karlsplatz, u6Spittelau] = await Promise.all([
                fetchUBahnDepartures(WL_STATIONS.KARLSPLATZ_U4, 'U4', 'Heiligenstadt'),
                fetchUBahnDepartures(WL_STATIONS.KARLSPLATZ_U1, 'U1', 'Leopoldau'),
                fetchUBahnDepartures(WL_STATIONS.SPITTELAU_U6, 'U6', 'Floridsdorf')
            ]);
            
            // Use Floridsdorf connections as base
            floridsdorfConnections.forEach(conn => {
                const key = `${conn.departure}_${conn.legs[0].line?.name || ''}`;
                connections.set(key, {
                    ...conn,
                    floridsdorfArrival: conn.arrival,
                    pratersternArrival: null,
                    ubahnConnections: {
                        karlsplatzU4: u4Karlsplatz.slice(0, 3), // Next 3 U4 departures from Karlsplatz
                        karlsplatzU1: u1Karlsplatz.slice(0, 3)  // Next 3 U1 departures from Karlsplatz
                    }
                });
            });
            
            // Add Praterstern arrival times
            pratersternConnections.forEach(conn => {
                const key = `${conn.departure}_${conn.legs[0].line?.name || ''}`;
                if (connections.has(key)) {
                    connections.get(key).pratersternArrival = conn.arrival;
                }
            });
            
            // Add direct U4->U6 connection from Karlsplatz
            if (u4Karlsplatz.length > 0) {
                const now = new Date();
                const u4Time = u4Karlsplatz[0].split(':');
                const u4Departure = new Date(now);
                u4Departure.setHours(parseInt(u4Time[0]), parseInt(u4Time[1]), 0, 0);
                
                // If departure is in the past, assume it's tomorrow
                if (u4Departure < now) {
                    u4Departure.setDate(u4Departure.getDate() + 1);
                }
                
                const spittelauArrival = new Date(u4Departure.getTime() + UBAHN_TRAVEL_TIMES['spittelau-karlsplatz'] * 60000);
                
                const u4U6Connection = {
                    departure: u4Departure.toISOString(),
                    arrival: spittelauArrival.toISOString(),
                    duration: UBAHN_TRAVEL_TIMES['spittelau-karlsplatz'] + 5 + UBAHN_TRAVEL_TIMES['floridsdorf-spittelau'],
                    transfers: 1,
                    isUBahn: true,
                    legs: [{
                        departure: u4Departure.toISOString(),
                        arrival: spittelauArrival.toISOString(),
                        line: { name: 'U4', product: 'subway' },
                        platform: null,
                        delay: 0,
                        direction: 'Heiligenstadt'
                    }],
                    ubahnConnections: {
                        spittelau: {
                            arrival: spittelauArrival.toISOString(),
                            nextU6: u6Spittelau,
                            floridsdorfArrival: calculateUBahnArrival(spittelauArrival.toISOString(), 5, UBAHN_TRAVEL_TIMES['floridsdorf-spittelau'])
                        }
                    }
                };
                
                connections.set(`u4_direct_${u4Departure.getTime()}`, u4U6Connection);
            }
        }
        
        // Log what we found
        console.log(`Direction: ${direction}, found ${connections.size} connections`);
        
    } catch (error) {
        console.error('Error fetching connections:', error);
    }
    
    // Convert Map to array, sort by departure time and return top 6
    return Array.from(connections.values())
        .sort((a, b) => new Date(a.departure) - new Date(b.departure))
        .slice(0, 6);
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
            
            const clean = (s) => s
            ?.replace(/\b(bahnhof|station|Wien|hbf)\b/gi, "")
            .replace(/\s+/g, " ")
            .trim();

            const cleanLineName = (s) =>
            s
            ?.replace(/\s*\(.*/, "")   // alles ab erster Klammer entfernen
            .trim();



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
                            name: cleanLineName(leg.line.name),
                            product: leg.line.product,
                            direction: leg.direction
                        } : null,
                        platform: leg.departurePlatform,
                        delay: leg.departureDelay,
                        direction: clean(leg.direction), // Add direction field
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
    
    // Handle U-Bahn direct connections differently
    if (connection.isUBahn) {
        return createUBahnConnectionElement(connection);
    }
    
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
    
    // Build U-Bahn connections HTML
    let ubahnHTML = '';
    if (connection.ubahnConnections) {
        if (currentDirection === 'forward') {
            // Forward direction: show U-Bahn connections to Karlsplatz
            if (connection.ubahnConnections.praterstern && connection.ubahnConnections.praterstern.nextU1.length > 0) {
                ubahnHTML += `
                    <div class="ubahn-info">
                        <span class="ubahn-line u1">U1</span> ab Praterstern: ${connection.ubahnConnections.praterstern.nextU1.join(', ')}
                        <span class="arrival-detail">→ Karlsplatz ${connection.ubahnConnections.praterstern.karlsplatzArrival}</span>
                    </div>
                `;
            }
            if (connection.ubahnConnections.wienMitte && connection.ubahnConnections.wienMitte.nextU4.length > 0) {
                ubahnHTML += `
                    <div class="ubahn-info">
                        <span class="ubahn-line u4">U4</span> ab Wien Mitte: ${connection.ubahnConnections.wienMitte.nextU4.join(', ')}
                        <span class="arrival-detail">→ Karlsplatz ${connection.ubahnConnections.wienMitte.karlsplatzArrival}</span>
                    </div>
                `;
            }
        } else {
            // Reverse direction: show U-Bahn options from Karlsplatz
            if (connection.ubahnConnections.karlsplatzU4 && connection.ubahnConnections.karlsplatzU4.length > 0) {
                ubahnHTML += `
                    <div class="ubahn-info">
                        Start ab Karlsplatz:
                        <br><span class="ubahn-line u4">U4</span> ${connection.ubahnConnections.karlsplatzU4.join(', ')}
                        <br><span class="ubahn-line u1">U1</span> ${connection.ubahnConnections.karlsplatzU1.join(', ')}
                    </div>
                `;
            }
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
            ${ubahnHTML}
            ${connection.transfers > 0 ? `<div class="transfers">${connection.transfers} Umstieg${connection.transfers > 1 ? 'e' : ''}</div>` : ''}
        </div>
    `;
    
    return div;
}

// Create U-Bahn connection element (for direct U6/U4 routes)
function createUBahnConnectionElement(connection) {
    const div = document.createElement('div');
    div.className = 'connection ubahn-direct';
    
    const depTime = new Date(connection.departure);
    const firstLeg = connection.legs[0];
    const lineName = firstLeg.line.name;
    
    let transferInfo = '';
    let finalDestination = '';
    
    if (currentDirection === 'forward') {
        // U6 from Floridsdorf
        const spittelauInfo = connection.ubahnConnections.spittelau;
        transferInfo = `
            <div class="transfer-station">
                <div>Spittelau: ${formatTime(new Date(spittelauInfo.arrival))}</div>
                <div class="ubahn-info">
                    <span class="ubahn-line u4">U4</span> ${spittelauInfo.nextU4.join(', ')}
                    <span class="arrival-detail">→ Karlsplatz ${spittelauInfo.karlsplatzArrival}</span>
                </div>
            </div>
        `;
        finalDestination = `Gesamtdauer: ${connection.duration} Min`;
    } else {
        // U4 from Karlsplatz
        const spittelauInfo = connection.ubahnConnections.spittelau;
        transferInfo = `
            <div class="transfer-station">
                <div>Spittelau: ${formatTime(new Date(spittelauInfo.arrival))}</div>
                <div class="ubahn-info">
                    <span class="ubahn-line u6">U6</span> ${spittelauInfo.nextU6.join(', ')}
                    <span class="arrival-detail">→ Floridsdorf ${spittelauInfo.floridsdorfArrival}</span>
                </div>
            </div>
        `;
        finalDestination = `Gesamtdauer: ${connection.duration} Min`;
    }
    
    div.innerHTML = `
        <div class="connection-header">
            <div class="departure-time">${formatTime(depTime)}</div>
            <div class="train-line">
                <span class="train-type ubahn-line ${lineName.toLowerCase()}">${lineName}</span>
            </div>
            <div class="train-direction">${firstLeg.direction}</div>
        </div>
        <div class="connection-details">
            ${transferInfo}
            <div class="duration">${finalDestination}</div>
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