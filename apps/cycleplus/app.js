/*
 * =============================================================
 * Cycle Plus - v2.0
 * =============================================================
 * A GPS cycling computer with ride saving and ghost comparison.
 *
 * - Press and hold BTN2 for the main menu.
 * - Saves "Work" and "Home" commutes separately.
 * - Compares your current ride against your previous best.
 * - Shows a GPS status indicator.
 * =============================================================
 */

// ---------------------------
// Modules and Helper Functions
// ---------------------------
const storage = require("Storage");

/**
 * Calculates distance between two GPS coordinates in kilometers.
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
  return R * c;
}

// ---------------------------
// App State
// ---------------------------
let isRunning = false;
let startTime = 0;
let distance = 0;
let lastFix = {
  fix: 0,
  speed: 0
};
let track = []; // Live track for the current ride
let rideType = ""; // "work" or "home"
let ghostTrack = []; // Loaded track from storage for comparison
let timeDiff = 0; // Time difference vs ghost ride

// ---------------------------
// Ghost Ride & Storage Logic
// ---------------------------

/**
 * Loads a previous ride from storage to act as the 'ghost'.
 * @param {string} type "work" or "home"
 */
function loadGhost(type) {
  let fileName = `cycleplus.${type}.json`;
  let data = storage.readJSON(fileName, true);
  if (data && data.track) {
    ghostTrack = data.track;
    E.showMessage(`Loaded ${type} ride`, "Ghost Ready");
  } else {
    ghostTrack = []; // Ensure it's empty if no file found
    E.showMessage(`No ${type} ride saved`, "No Ghost");
  }
}

/**
 * Saves the current ride to storage.
 * @param {string} type "work" or "home"
 */
function saveRide(type) {
  if (track.length < 2) {
    E.showMessage("Ride too short", "Not Saved");
    return;
  }
  let fileName = `cycleplus.${type}.json`;
  let data = {
    duration: getTime() - startTime,
    track: track
  };
  storage.writeJSON(fileName, data);
  E.showMessage(`Saved ${type} ride`, "Ride Saved");
}

/**
 * Calculates the ghost's expected time at our current distance.
 * This allows for a real-time ahead/behind comparison.
 */
function getGhostTimeAtCurrentDist() {
  if (ghostTrack.length < 2) return 0;

  let currentDist = distance;
  // Find segment in ghost track where our current distance falls
  for (let i = 1; i < ghostTrack.length; i++) {
    let p1 = ghostTrack[i - 1];
    let p2 = ghostTrack[i];
    if (p1.dist <= currentDist && currentDist <= p2.dist) {
      // Linear interpolation to find the time
      let distSegment = p2.dist - p1.dist;
      if (distSegment <= 0) return p1.time; // Avoid division by zero
      let distIntoSegment = currentDist - p1.dist;
      let proportion = distIntoSegment / distSegment;
      let timeSegment = p2.time - p1.time;
      return p1.time + (timeSegment * proportion);
    }
  }
  return 0; // Not on the ghost track path
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
}

function startRide(type) {
  resetState();
  rideType = type;
  isRunning = true;
  loadGhost(type);
  Bangle.setGPSPower(1, "cycleplus");
  E.showScroller({
    h: 40, c: 1,
    draw: (idx, r) => {
      g.clearRect(r.x, r.y, r.x + r.w - 1, r.y + r.h - 1).setColor(g.theme.fg);
      if (idx === 0) g.setFont("6x8:2").setFontAlign(0, 0, 0).drawString("Waiting for\nGPS signal...", r.x + r.w / 2, r.y + r.h / 2);
    }
  });
}

function stopRide() {
  if (!isRunning) return;
  isRunning = false;
  Bangle.setGPSPower(0, "cycleplus");
  showSaveMenu();
}

function onGPS(fix) {
  lastFix = fix;
  if (!fix.fix || !isRunning) return;

  let currentElapsedTime = getTime() - startTime;

  if (fix.lat !== undefined) {
    let lastPoint = track.length > 0 ? track[track.length - 1] : null;
    if (lastPoint) {
      distance += haversine(lastPoint.lat, lastPoint.lon, fix.lat, fix.lon);
    } else {
      startTime = getTime(); // Start timer on first valid fix
      currentElapsedTime = 0;
    }
    // Add point to our live track with cumulative distance and time
    track.push({
      lat: fix.lat,
      lon: fix.lon,
      time: currentElapsedTime,
      dist: distance
    });
  }

  // Update comparison
  let ghostTime = getGhostTimeAtCurrentDist();
  if (ghostTime > 0) {
    timeDiff = currentElapsedTime - ghostTime;
  }
}

// ---------------------------
// UI and Drawing
// ---------------------------
function draw() {
  g.reset().clearRect(Bangle.appRect);

  // 1. GPS Status Indicator
  g.setFont("6x8", 1).setFontAlign(0, -1);
  if (lastFix.fix) {
    g.setColor(0, 1, 0); // Green
    g.drawString("GPS", g.getWidth() / 2, 4);
  } else {
    g.setColor(1, 0, 0); // Red
    g.drawString("GPS", g.getWidth() / 2, 4);
  }

  // 2. Current Time
  let now = new Date();
  let timeStr = require("locale").time(now, 1);
  g.setColor(g.theme.fg).setFont("6x8", 2).setFontAlign(0, -1);
  g.drawString(timeStr, g.getWidth() / 2, 16);

  // 3. Speed (Doubled Size)
  let speed = lastFix.speed.toFixed(1);
  g.setFont("Vector", 80).setFontAlign(0, 0);
  g.drawString(speed, g.getWidth() / 2, 80);

  // 4. Breadcrumb Trail (bottom third)
  if (track.length > 1) {
    const trailRect = { x: 0, y: 120, w: g.getWidth(), h: g.getHeight() - 120 };
    g.setClipRect(trailRect.x, trailRect.y, trailRect.x + trailRect.w - 1, trailRect.y + trailRect.h - 1);
    let projectedTrack = track.map(p => Bangle.project(p));
    g.setColor("#0ff").drawPoly(projectedTrack, false);
    g.reset();
  }

  // 5. Duration and Time Difference
  let durationStr = "00:00:00";
  if (isRunning) {
    let duration = getTime() - startTime;
    let hours = Math.floor(duration / 3600);
    let mins = Math.floor(duration / 60) % 60;
    let secs = Math.floor(duration % 60);
    durationStr = ("0" + hours).substr(-2) + ":" + ("0" + mins).substr(-2) + ":" + ("0" + secs).substr(-2);
  }
  g.setFont("6x8", 2).setFontAlign(0, 1); // Bottom-center
  g.drawString(durationStr, g.getWidth() / 2, g.getHeight() - 4);

  if (ghostTrack.length > 0 && isRunning) {
    let diffStr = (timeDiff > 0 ? "+" : "") + Math.round(timeDiff);
    g.setColor(timeDiff > 0 ? "#f00" : "#0f0"); // Red if behind, green if ahead
    g.setFontAlign(1, 1); // Bottom-right
    g.drawString(`${diffStr}s`, g.getWidth() - 4, g.getHeight() - 4);
  }
}

// ---------------------------
// Menus
// ---------------------------
function showMainMenu() {
  const mainMenu = {
    "": { "title": "Cycle Plus" },
    "Start Ride": showStartMenu,
    "Stop & Save": () => {
      if (!isRunning) E.showMessage("Not started");
      else stopRide();
    },
    "Exit": () => load(),
  };
  E.showMenu(mainMenu);
}

function showStartMenu() {
  const startMenu = {
    "": { "title": "Start Ride" },
    "To Work": () => {
      E.showMenu();
      startRide("work");
    },
    "To Home": () => {
      E.showMenu();
      startRide("home");
    },
    "< Back": showMainMenu,
  };
  E.showMenu(startMenu);
}

function showSaveMenu() {
  const saveMenu = {
    "": { "title": "Save Ride" },
    "As Work Ride": () => {
      saveRide("work");
      resetState();
      showMainMenu();
    },
    "As Home Ride": () => {
      saveRide("home");
      resetState();
      showMainMenu();
    },
    "Don't Save": () => {
      resetState();
      showMainMenu();
    },
  };
  E.showMenu(saveMenu);
}

// ---------------------------
// Event Listeners & Init
// ---------------------------
g.clear();
Bangle.loadWidgets();
Bangle.drawWidgets();

Bangle.on('GPS', onGPS);
setInterval(draw, 1000);

let pressTimeout;
function setUI() {
  setWatch(() => { // on press
    if (Bangle.isLCDOn()) {
      pressTimeout = setTimeout(showMainMenu, 2000);
    }
  }, BTN2, { repeat: true, edge: "rising" });

  setWatch(() => { // on release
    if (pressTimeout) clearTimeout(pressTimeout);
  }, BTN2, { repeat: true, edge: "falling" });
}

// Initial state
resetState();
draw();
setUI();
