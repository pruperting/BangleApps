/*
 * =============================================================
 * Cycle Plus - Bangle.js Cycling Computer
 * =============================================================
 * A simple GPS cycling tracker with a graphical layout.
 *
 * - Tracks: Current Speed, Max Speed, Distance, Duration
 * - Displays: Breadcrumb trail of your current ride
 * - Simplified for core functionality (no history/saving).
 * =============================================================
 */

// ---------------------------
// Helper Function (Haversine Formula)
// ---------------------------
/**
 * Calculates the distance between two GPS coordinates.
 * @returns {number} The distance in kilometers.
 */
function haversine(lat1, lon1, lat2, lon2) {
  var R = 6371; // Radius of the Earth in km
  var dLat = (lat2 - lat1) * Math.PI / 180;
  var dLon = (lon2 - lon1) * Math.PI / 180;
  var a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in km
}

// ---------------------------
// App Setup
// ---------------------------

// Load other apps and widgets
Bangle.loadWidgets();

// App state variables
let isRunning = false;
let startTime = 0;
let distance = 0;
let maxSpeed = 0;
let lastFix = null;
let track = [];

// ---------------------------
// Core Functions
// ---------------------------

/**
 * Reset all ride data to initial values.
 */
function resetState() {
  distance = 0;
  maxSpeed = 0;
  startTime = 0;
  lastFix = null;
  track = [];
}

/**
 * Draw the main application UI based on the new layout.
 */
/**
 * Draw the main application UI with the large-font layout.
 */
function draw() {
  g.reset(); // Reset graphics state
  g.clearRect(0, 24, g.getWidth(), g.getHeight()); // Clear below widgets

  // --- Get values and format them ---
  let now = new Date();
  let timeStr = require("locale").time(now, 1);
  let speed = lastFix ? lastFix.speed.toFixed(1) : "0.0";
  let distStr = distance.toFixed(2);

  let durationStr = "00:00:00";
  if (isRunning) {
    let duration = getTime() - startTime;
    let hours = Math.floor(duration / 3600);
    let mins = Math.floor(duration / 60) % 60;
    let secs = Math.floor(duration % 60);
    durationStr = ("0" + hours).substr(-2) + ":" + ("0" + mins).substr(-2) + ":" + ("0" + secs).substr(-2);
  }

  // --- Top Row: Time (left) and Duration (right) ---
  g.setFont("6x8", 2);
  g.setFontAlign(-1, -1); // Align Top-Left
  g.drawString(timeStr, 5, 30);
  g.setFontAlign(1, -1);  // Align Top-Right
  g.drawString(durationStr, g.getWidth() - 5, 30);


  // --- Left 2/3: Current Speed (very large) ---
  // The area for speed is from the left edge to 2/3 of the screen width
  const speedAreaX = (g.getWidth() / 3) * 2;
  g.setFont("Vector", 80); // Use a large, scalable font
  g.setFontAlign(0, 0); // Align Center-Center
  g.drawString(speed, speedAreaX / 2, 115); // Draw in the middle of the area


  // --- Right 1/3: Distance ---
  // The area for distance is the final 1/3 of the screen width
  const distAreaX = (g.getWidth() / 3) * 2;
  g.setFont("Vector", 40);
  g.setFontAlign(0, 0); // Align Center-Center
  g.drawString(distStr, distAreaX + (g.getWidth() / 6), 115); // Draw in the middle of the area
}

/**
 * Handle incoming GPS data.
 */
function onGPS(fix) {
  if (!fix.fix || !isRunning) return; // Skip if no fix or not running

  // Update speed
  if (fix.speed > maxSpeed) {
    maxSpeed = fix.speed;
  }

  // Update distance and track
  if (lastFix) {
    distance += haversine(lastFix.lat, lastFix.lon, fix.lat, fix.lon);
    track.push({ lat: fix.lat, lon: fix.lon });

    // Keep track array from getting too big
    if (track.length > 100) {
      track.shift();
    }
  } else {
    // This is the first fix, start the timer
    startTime = getTime();
    track.push({ lat: fix.lat, lon: fix.lon });
  }

  lastFix = fix;
}

/**
 * Start tracking the ride.
 */
function startRide() {
  if (isRunning) return;
  isRunning = true;
  resetState();
  Bangle.setGPSPower(1, "cycleplus");
  E.showScroller({
    h: 40,
    c: 1,
    draw: (idx, r) => {
      g.clearRect(r.x, r.y, r.x + r.w - 1, r.y + r.h - 1).setColor(g.theme.fg);
      if (idx === 0) {
        g.setFont("6x8:2").setFontAlign(0, 0, 0).drawString("Waiting for\nGPS signal...", r.x + r.w / 2, r.y + r.h / 2);
      }
    }
  });
}

/**
 * Stop tracking the ride.
 */
function stopRide() {
  if (!isRunning) return;
  isRunning = false;
  Bangle.setGPSPower(0, "cycleplus");
  E.showMessage("Ride Stopped", "Cycle Plus");
  lastFix = null; // Clear lastFix so speed resets on screen
  draw(); // Redraw to show final stats
}

// ---------------------------
// Event Listeners & UI
// ---------------------------

// Clear screen on start
g.clear();
Bangle.drawWidgets();

// Handle GPS events
Bangle.on('GPS', onGPS);

// Update screen every second
setInterval(draw, 1000);

// Set up button controls
function setUI() {
  setWatch(() => {
    if (isRunning) {
      stopRide();
    } else {
      startRide();
    }
  }, BTN2, { repeat: true, edge: "rising" });
}

// ---------------------------
// Initial Execution
// ---------------------------
resetState();
draw();
setUI();
