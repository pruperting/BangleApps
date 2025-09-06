/*
 * =============================================================
 * Cycle Plus - v4.0 (New Logic)
 * =============================================================
 * A GPS cycling computer with ride saving and ghost comparison.
 *
 * - REWRITE: Complete logic overhaul for stability and usability.
 * - App now starts with a clear "Start Ride" menu.
 * - No more "Waiting for GPS" screen; ride starts automatically
 * on the main screen when a GPS fix is acquired.
 * - BTN2 now pauses the ride and opens a context-aware save menu.
 * - Simplified UI flow to prevent crashes.
 * =============================================================
 */

// ---------------------------
// Modules and Helper Functions
// ---------------------------
const storage = require("Storage");

function haversine(lat1, lon1, lat2, lon2) {
  var R = 6371; // Earth's radius in km
  var dLat = (lat2 - lat1) * Math.PI / 180;
  var dLon = (lon2 - lon1) * Math.PI / 180;
  var a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // distance in km
}

// ---------------------------
// App State
// ---------------------------
let isRunning = false;
let startTime = 0;
let distance = 0; // in km
let lastFix = { fix: 0, speed: 0 };
let track = [];
let rideType = ""; // "work" or "home"
let ghostTrack = [];
let timeDiff = 0; // in seconds
let drawInterval;

// ---------------------------
// Ghost Ride & Storage Logic
// ---------------------------
function loadGhost(type) {
  let fileName = `cycleplus.${type}.json`;
  let data = storage.readJSON(fileName, true);
  ghostTrack = (data && data.track) ? data.track : [];
}

function saveRide(type) {
  if (track.length < 2) return; // Ride too short
  let fileName = `cycleplus.${type}.json`;
  let data = {
    duration: getTime() - startTime,
    track: track
  };
  storage.writeJSON(fileName, data);
}

function getGhostTimeAtCurrentDist() {
  if (ghostTrack.length < 2) return 0;
  let currentDist = distance;
  for (let i = 1; i < ghostTrack.length; i++) {
    let p1 = ghostTrack[i - 1];
    let p2 = ghostTrack[i];
    if (p1.dist <= currentDist && currentDist <= p2.dist) {
      let distSegment = p2.dist - p1.dist;
      if (distSegment <= 0) return p1.time;
      let distIntoSegment = currentDist - p1.dist;
      let proportion = distIntoSegment / distSegment;
      let timeSegment = p2.time - p1.time;
      return p1.time + (timeSegment * proportion);
    }
  }
  return 0;
}

// ---------------------------
// Core Functions
// ---------------------------
function resetState() {
  isRunning = false;
  distance = 0;
  startTime = 0;
  track = [];
  ghostTrack = [];
  timeDiff = 0;
  rideType = "";
  if (drawInterval) {
    clearInterval(drawInterval);
    drawInterval = undefined;
  }
  Bangle.setGPSPower(0, "cycleplus");
}

function startRide(type) {
  resetState();
  rideType = type;
  loadGhost(type);

  // Show the main screen immediately
  g.clear();
  draw(); // Draw initial screen
  drawInterval = setInterval(draw, 1000);
  setUI(); // Set up button to pause the ride

  // Turn on GPS and wait for a fix
  Bangle.setGPSPower(1, "cycleplus");
}

function stopRide() {
  isRunning = false; // Pause the ride
  if (drawInterval) clearInterval(drawInterval);
  drawInterval = undefined;
  clearWatch();

  // Define the menu object first
  const saveMenu = {
    "": { "title": "Ride Paused" },
    "Continue Ride": () => {
      // Return to the ride screen
      E.showMenu(); // Hide this menu
      isRunning = true;
      setUI();
      drawInterval = setInterval(draw, 1000);
    },
    // The dynamic 'Save' option will be added below
    "Discard & Exit": () => {
      resetState();
      load(); // Exit app
    }
  };

  // Now, add the dynamic menu item in a way that all JS versions understand
  saveMenu[`Save as ${rideType}`] = () => {
    saveRide(rideType);
    resetState();
    E.showMessage(`Saved ${rideType} ride`, "Ride Saved");
    setTimeout(showStartMenu, 1000);
  };

  E.showMenu(saveMenu);
}

function onGPS(fix) {
  lastFix = fix;

  // Start the ride automatically on the first good GPS fix
  if (rideType && !isRunning && fix.fix) {
    isRunning = true;
    startTime = getTime();
    track.push({ lat: fix.lat, lon: fix.lon, time: 0, dist: 0 });
  }

  if (isRunning && fix.fix) {
    let currentElapsedTime = getTime() - startTime;
    if (fix.lat !== undefined) {
      let lastPoint = track[track.length - 1];
      if (lastPoint) {
        distance += haversine(lastPoint.lat, lastPoint.lon, fix.lat, fix.lon);
      }
      track.push({
        lat: fix.lat, lon: fix.lon,
        time: currentElapsedTime, dist: distance
      });
    }
    let ghostTime = getGhostTimeAtCurrentDist();
    if (ghostTime > 0) {
      timeDiff = currentElapsedTime - ghostTime;
    }
  }
}

// ---------------------------
// UI and Drawing
// ---------------------------
function draw() {
  g.reset().clearRect(Bangle.appRect);

  // GPS indicator
  g.setFont("6x8", 1).setFontAlign(0, -1);
  if (lastFix.fix) {
    g.setColor(0, 1, 0).drawString("GPS", g.getWidth() / 2, 4);
  } else {
    g.setColor(1, 0, 0).drawString("GPS", g.getWidth() / 2, 4);
  }

  // Clock
  let now = new Date();
  let timeStr = require("locale").time(now, 1);
  g.setColor(g.theme.fg).setFont("6x8", 2).setFontAlign(0, -1);
  g.drawString(timeStr, g.getWidth() / 2, 16);

  // Speed
  let speed = lastFix.speed.toFixed(1);
  g.setFont("Vector", 80).setFontAlign(0, 0);
  g.drawString(speed, g.getWidth() / 2, 80);

  // Duration
  let durationStr = "00:00:00";
  if (startTime > 0) {
    let duration = getTime() - startTime;
    let hours = Math.floor(duration / 3600);
    let mins = Math.floor(duration / 60) % 60;
    let secs = Math.floor(duration % 60);
    durationStr = ("0" + hours).substr(-2) + ":" + ("0" + mins).substr(-2) + ":" + ("0" + secs).substr(-2);
  }
  g.setFont("6x8", 2).setFontAlign(0, 1);
  g.drawString(durationStr, g.getWidth() / 2, g.getHeight() - 4);

  // Ghost comparison
  if (ghostTrack.length > 0 && isRunning) {
    let diffStr = (timeDiff > 0 ? "+" : "") + Math.round(timeDiff);
    g.setColor(timeDiff > 0 ? "#f00" : "#0f0"); // Red for behind, Green for ahead
    g.setFontAlign(1, 1);
    g.drawString(`${diffStr}s`, g.getWidth() - 4, g.getHeight() - 4);
  }
}

// ---------------------------
// Menus
// ---------------------------
function showStartMenu() {
  const startMenu = {
    "": { "title": "Cycle Plus" },
    "Ride to Work": () => {
      E.showMenu(); // Clear menu before starting
      startRide("work");
    },
    "Ride to Home": () => {
      E.showMenu(); // Clear menu before starting
      startRide("home");
    },
    "Exit": () => load(),
  };
  E.showMenu(startMenu);
}

// ---------------------------
// Event Listeners & Init
// ---------------------------
function setUI() {
  clearWatch();
  // Press BTN2 to stop/pause the ride
  setWatch(stopRide, BTN2, { repeat: false, edge: "rising" });
}

Bangle.on('GPS', onGPS);
// Ensure GPS is turned off when the app is killed
Bangle.on('kill', () => {
  Bangle.setGPSPower(0, "cycleplus");
});

// ---------------------------
// Initial Execution
// ---------------------------
g.clear();
Bangle.loadWidgets();
Bangle.drawWidgets();
showStartMenu();



