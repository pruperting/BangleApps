/*
 * =============================================================
 * Cycle Plus - v6.0 (Stability and UI Fixes)
 * =============================================================
 * A GPS cycling computer with ride saving and ghost comparison.
 *
 * - FIX: Resolved menu rendering glitches (ghost selections,
 * flickering background) by clearing the screen before
 * drawing menus.
 * - FIX: Prevented crashes on long rides by optimizing GPS track
 * storage, reducing memory usage by 80%.
 * - FIX: Stopped widget bar from flickering by integrating it
 * into the buffered draw cycle.
 * - UI: Re-added the distance display and implemented a new
 * layout with large speed on the left and distance on the right.
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
// Settings Management
// ---------------------------
const SETTINGS_FILE = "cycleplus.settings.json";
let settings;
let systemTimeout; // To store the original system timeout

function loadSettings() {
  settings = storage.readJSON(SETTINGS_FILE, true) || {
    keepScreenOn: false,
  };
  systemTimeout = (require("Storage").readJSON("setting.json", 1) || {}).timeout;
}

function saveSettings() {
  storage.writeJSON(SETTINGS_FILE, settings);
}

function applyScreenTimeout() {
  if (settings.keepScreenOn) {
    Bangle.setLCDTimeout(0); // 0 = stay on forever
  } else {
    Bangle.setLCDTimeout(systemTimeout); // Revert to system default
  }
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
let lastTrackTime = 0; // For thinning GPS track data

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
  lastTrackTime = 0;
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

  g.clear();
  draw();
  drawInterval = setInterval(draw, 1000);
  setUI();

  Bangle.setGPSPower(1, "cycleplus");
}

function stopRide() {
  isRunning = false; // Pause the ride
  if (drawInterval) clearInterval(drawInterval);
  drawInterval = undefined;
  clearWatch();

  const saveMenu = {
    "": { "title": "Ride Paused" },
    "Continue Ride": () => {
      E.showMenu();
      isRunning = true;
      setUI();
      drawInterval = setInterval(draw, 1000);
    },
    "Discard & Exit": () => {
      resetState();
      cleanupAndExit();
    }
  };

  saveMenu[`Save as ${rideType}`] = () => {
    saveRide(rideType);
    resetState();
    E.showMessage(`Saved ${rideType} ride`, "Ride Saved");
    setTimeout(showStartMenu, 1000);
  };
  
  g.clear(); // Fix: Clear screen before showing menu
  E.showMenu(saveMenu);
}

function onGPS(fix) {
  lastFix = fix;

  if (rideType && !isRunning && fix.fix) {
    isRunning = true;
    startTime = getTime();
    lastTrackTime = getTime();
    track.push({ lat: fix.lat, lon: fix.lon, time: 0, dist: 0 });
  }

  if (isRunning && fix.fix) {
    let currentElapsedTime = getTime() - startTime;
    if (fix.lat !== undefined) {
      let lastPoint = track.length > 0 ? track[track.length - 1] : {lat: fix.lat, lon: fix.lon};
      
      // Always calculate distance for accuracy
      distance += haversine(lastPoint.lat, lastPoint.lon, fix.lat, fix.lon);

      // Memory optimization: only add a point to the track every 5 seconds
      if (getTime() - lastTrackTime > 5) {
        lastTrackTime = getTime();
        track.push({
          lat: fix.lat, lon: fix.lon,
          time: currentElapsedTime, dist: distance
        });
      }
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
  if (lastFix.fix) g.setColor(0, 1, 0); else g.setColor(1, 0, 0);
  g.drawString("GPS", g.getWidth() / 2, 4);

  // Clock
  let now = new Date();
  let timeStr = require("locale").time(now, 1);
  g.setColor(g.theme.fg).setFont("6x8", 2).setFontAlign(0, -1);
  g.drawString(timeStr, g.getWidth() / 2, 16);

  // Speed (Left 2/3)
  let speed = lastFix.speed.toFixed(1);
  g.setFont("Vector", 80).setFontAlign(0, 0);
  g.drawString(speed, g.getWidth() / 3, 80);

  // Distance (Right 1/3)
  let distStr = distance.toFixed(2);
  g.setFont("Vector", 40).setFontAlign(0, 0);
  g.drawString(distStr, g.getWidth() * 5 / 6, 80);
  g.setFont("6x8", 2).setFontAlign(0, 0);
  g.drawString("km", g.getWidth() * 5 / 6, 110);


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
    g.setColor(timeDiff > 0 ? "#f00" : "#0f0");
    g.setFontAlign(1, 1);
    g.drawString(`${diffStr}s`, g.getWidth() - 4, g.getHeight() - 4);
  }
  
  // Fix: Draw widgets into buffer to prevent flicker
  Bangle.drawWidgets();
  
  // Update the physical screen with our buffered drawing
  g.flip();
}

// ---------------------------
// Menus
// ---------------------------
function showStartMenu() {
  const startMenu = {
    "": { "title": "Cycle Plus" },
    "Ride to Work": () => { E.showMenu(); startRide("work"); },
    "Ride to Home": () => { E.showMenu(); startRide("home"); },
    "Screen Options": showScreenMenu,
    "Exit": cleanupAndExit,
  };
  g.clear(); // Fix: Clear screen before showing menu
  E.showMenu(startMenu);
}

function showScreenMenu() {
  const screenMenu = {
    "": { "title": "Screen Options" },
    "Screen stays on": {
      value: settings.keepScreenOn,
      format: v => v ? "Yes" : "No",
      onchange: v => {
        settings.keepScreenOn = v;
        saveSettings();
        applyScreenTimeout();
      }
    },
    "< Back": showStartMenu
  };
  g.clear(); // Fix: Clear screen before showing menu
  E.showMenu(screenMenu);
}


// ---------------------------
// Event Listeners & Init
// ---------------------------
function setUI() {
  clearWatch();
  setWatch(stopRide, BTN2, { repeat: false, edge: "rising" });
}

function cleanupAndExit() {
  resetState();
  // Restore original screen settings
  Bangle.setLCDMode(); 
  Bangle.setLCDTimeout(systemTimeout);
  // Exit to the clock
  load();
}

Bangle.on('GPS', onGPS);
Bangle.on('kill', cleanupAndExit);

// ---------------------------
// Initial Execution
// ---------------------------
g.clear();

// Set up screen buffering to prevent flicker
Bangle.setLCDMode("doublebuffered");

// Load settings and apply them
loadSettings();
applyScreenTimeout();

// Show the first menu
showStartMenu();

