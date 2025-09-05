/*
 * =============================================================
 * Cycle Plus - Bangle.js Cycling Computer
 * =============================================================
 * A simple GPS cycling tracker with a balanced graphical layout.
 *
 * - Tracks: Current Speed, Distance, Duration
 * - Displays: Large numbers plus a breadcrumb trail of your ride.
 * =============================================================
 */

// ---------------------------
// Helper Function (Haversine Formula)
// ---------------------------
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
Bangle.loadWidgets();

let isRunning = false;
let startTime = 0;
let distance = 0;
let lastFix = null;
let track = []; // Re-added for the breadcrumb trail

// ---------------------------
// Core Functions
// ---------------------------
function resetState() {
  distance = 0;
  startTime = 0;
  lastFix = null;
  track = []; // Re-added for the breadcrumb trail
}

/**
 * Draw the main application UI with the balanced layout.
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

  // --- Top Row: Time ---
  g.setFont("6x8", 2);
  g.setFontAlign(-1, -1); // Align Top-Left
  g.drawString(timeStr, 5, 30);

  // --- Middle Row: Speed (left) and Distance (right) ---
  g.setFont("Vector", 45);
  g.setFontAlign(-1, 0); // Align Middle-Left
  g.drawString(speed, 5, 80);
  g.setFontAlign(1, 0);  // Align Middle-Right
  g.drawString(distStr, g.getWidth() - 5, 80);

  // --- Bottom Third: Breadcrumb Trail ---
  if (track.length > 1) {
    const trailRect = { x: 0, y: 115, w: g.getWidth(), h: g.getHeight() - 115 };
    g.setClipRect(trailRect.x, trailRect.y, trailRect.w - 1, trailRect.y + trailRect.h - 1);
    let projectedTrack = track.map(p => Bangle.project(p));
    g.setColor("#0ff").drawPoly(projectedTrack, false);
    g.reset(); // Remove the clipping rectangle
  }

  // --- Bottom Row: Duration ---
  g.setFont("6x8", 2);
  g.setFontAlign(0, 1); // Align Bottom-Center
  g.drawString(durationStr, g.getWidth() / 2, g.getHeight() - 5);
}

function onGPS(fix) {
  if (!fix.fix || !isRunning) return; // Skip if no fix or not running

  if (lastFix) {
    distance += haversine(lastFix.lat, lastFix.lon, fix.lat, fix.lon);
    // Add current location to the track for the breadcrumb trail
    track.push({ lat: fix.lat, lon: fix.lon });
    if (track.length > 100) track.shift(); // Keep trail to a manageable size

  } else {
    // This is the first fix, start the timer and track
    startTime = getTime();
    track.push({ lat: fix.lat, lon: fix.lon });
  }
  lastFix = fix;
}

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

function stopRide() {
  if (!isRunning) return;
  isRunning = false;
  Bangle.setGPSPower(0, "cycleplus");
  E.showMessage("Ride Stopped", "Cycle Plus");
  lastFix = null;
  draw();
}

// ---------------------------
// Event Listeners & UI
// ---------------------------
g.clear();
Bangle.drawWidgets();

Bangle.on('GPS', onGPS);

setInterval(draw, 1000);

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
