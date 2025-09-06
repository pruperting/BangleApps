/*
 * =============================================================
 * Cycle Plus - v7.2 (State Reset Fix)
 * =============================================================
 * A GPS cycling computer with ghost race and commute tracking.
 *
 * - FIX: Resolved a critical state management bug that caused a
 * crash after completing one ride and starting another. The
 * app's state is now fully reset when a ride ends, preventing
 * stale data from causing crashes on subsequent rides.
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
let distTimeDiff = 0; // Distance-based time difference
let locTimeDiff = 0; // Location-based time difference
let drawInterval;
let lastTrackTime = 0; // For thinning GPS track data
let lastGhostUpdateTime = 0; // For throttling ghost calculations
let stopRideWatch; // For managing the pause button watch

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

// --- Ghost Method 1: Distance-Based ---
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

// --- Ghost Method 2: Location-Based ---
function getGhostTimeAtCurrentLocation(fix) {
  if (ghostTrack.length < 2 || !fix.fix) return 0;
  let minDist = -1;
  let closestPoint = null;

  for (const p of ghostTrack) {
    const d = haversine(fix.lat, fix.lon, p.lat, p.lon);
    if (minDist < 0 || d < minDist) {
      minDist = d;
      closestPoint = p;
    }
  }
  return closestPoint ? closestPoint.time : 0;
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
  distTimeDiff = 0;
  locTimeDiff = 0;
  rideType = "";
  lastTrackTime = 0;
  lastGhostUpdateTime = 0;

  // FIX: Ensure the watch ID is always cleared when state is reset.
  stopRideWatch = undefined;

  if (drawInterval) {
    clearInterval(drawInterval);
    drawInterval = undefined;
  }
  Bangle.setGPSPower(0, "cycleplus");
}

function startRide(type) {
  Bangle.setLCDMode("doublebuffered");
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
  isRunning = false;
  if (drawInterval) {
    clearInterval(drawInterval);
    drawInterval = undefined;
  }

  const saveMenu = {
    "": { "title": "Ride Paused" },
    "Continue Ride": () => {
      E.showMenu();
      Bangle.setLCDMode("doublebuffered");
      isRunning = true;

      // FIX: Explicitly mark the old watch as gone before setting a new one.
      // The menu system clears the actual watch; this just updates our variable
      // to prevent a crash when setUI is called.
      stopRideWatch = undefined;

      setUI();
      draw();
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
  
  showMenu(saveMenu);
}

function onGPS(fix) {
  lastFix = fix;

  if (rideType && !isRunning && fix.fix) {
    isRunning = true;
    startTime = getTime();
    lastTrackTime = getTime();
    lastGhostUpdateTime = getTime();
    track.push({ lat: fix.lat, lon: fix.lon, time: 0, dist: 0 });
  }

  if (isRunning && fix.fix) {
    let currentElapsedTime = getTime() - startTime;
    if (fix.lat !== undefined) {
      let lastPoint = track.length > 0 ? track[track.length - 1] : {lat: fix.lat, lon: fix.lon};
      
      distance += haversine(lastPoint.lat, lastPoint.lon, fix.lat, fix.lon);

      if (getTime() - lastTrackTime > 5) {
        lastTrackTime = getTime();
        track.push({
          lat: fix.lat, lon: fix.lon,
          time: currentElapsedTime, dist: distance
        });
      }
    }
    
    // Performance: Throttle ghost calculations
    if (getTime() - lastGhostUpdateTime > 5) {
      lastGhostUpdateTime = getTime();
      
      let ghostDistTime = getGhostTimeAtCurrentDist();
      if (ghostDistTime > 0) distTimeDiff = currentElapsedTime - ghostDistTime;
      
      let ghostLocTime = getGhostTimeAtCurrentLocation(fix);
      if (ghostLocTime > 0) locTimeDiff = currentElapsedTime - ghostLocTime;
    }
  }
}

// ---------------------------
// UI and Drawing
// ---------------------------
function draw() {
  const r = Bangle.appRect;
  g.reset().clearRect(r);

  // GPS indicator
  g.setFont("6x8", 1).setFontAlign(0, -1);
  if (lastFix.fix) g.setColor(0, 1, 0); else g.setColor(1, 0, 0);
  g.drawString("GPS", r.w / 2, r.y + 4);

  // Clock
  let now = new Date();
  let timeStr = require("locale").time(now, 1);
  g.setColor(g.theme.fg).setFont("6x8", 2).setFontAlign(0, -1);
  g.drawString(timeStr, r.w / 2, r.y + 16);

  // Speed (Left 2/3)
  let speed = lastFix.speed.toFixed(1);
  g.setFont("Vector", 80).setFontAlign(0, 0);
  g.drawString(speed, r.w / 3, r.y + r.h / 2);

  // --- Data Block (Right 1/3) ---
  const dataBlockX = r.w * 5 / 6;

  // Total Distance
  let distStr = distance.toFixed(2);
  g.setFont("Vector", 40).setFontAlign(0, 0);
  g.drawString(distStr, dataBlockX, r.y + r.h / 2);
  g.setFont("6x8", 2).setFontAlign(0, 0);
  g.drawString("km", dataBlockX, r.y + r.h / 2 + 30);

  if (ghostTrack.length > 0 && isRunning) {
    // Distance-based diff (Left of distance)
    let distDiffStr = (distTimeDiff > 0 ? "+" : "") + Math.round(distTimeDiff);
    g.setColor(distTimeDiff > 0 ? "#f00" : "#0f0").setFont("6x8", 2);
    g.setFontAlign(1, 0).drawString(distDiffStr, dataBlockX - 35, r.y + r.h / 2);
    g.setFontAlign(1, 0).drawString("D", dataBlockX - 35, r.y + r.h / 2 - 12);

    // Location-based diff (Right of distance)
    let locDiffStr = (locTimeDiff > 0 ? "+" : "") + Math.round(locTimeDiff);
    g.setColor(locTimeDiff > 0 ? "#f00" : "#0f0");
    g.setFontAlign(-1, 0).drawString(locDiffStr, dataBlockX + 35, r.y + r.h / 2);
    g.setFontAlign(-1, 0).drawString("L", dataBlockX + 35, r.y + r.h / 2 - 12);
  }

  // Duration
  let durationStr = "00:00:00";
  if (startTime > 0) {
    let duration = getTime() - startTime;
    let hours = Math.floor(duration / 3600);
    let mins = Math.floor(duration / 60) % 60;
    let secs = Math.floor(duration % 60);
    durationStr = ("0" + hours).substr(-2) + ":" + ("0" + mins).substr(-2) + ":" + ("0" + secs).substr(-2);
  }
  g.setColor(g.theme.fg).setFont("6x8", 2).setFontAlign(0, 1);
  g.drawString(durationStr, r.w / 2, r.y + r.h - 4);
  
  Bangle.drawWidgets();
  g.flip();
}

// ---------------------------
// Menus
// ---------------------------
function showMenu(menu) {
  Bangle.setLCDMode(); 
  g.clear();
  E.showMenu(menu);
}

function showStartMenu() {
  const startMenu = {
    "": { "title": "Cycle Plus" },
    "Ride to Work": () => startRide("work"),
    "Ride to Home": () => startRide("home"),
    "Screen Options": showScreenMenu,
    "Exit": cleanupAndExit,
  };
  showMenu(startMenu);
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
  showMenu(screenMenu);
}


// ---------------------------
// Event Listeners & Init
// ---------------------------
function setUI() {
  if (stopRideWatch) clearWatch(stopRideWatch);
  stopRideWatch = setWatch(stopRide, BTN2, { repeat: false, edge: "rising" });
}

function cleanupAndExit() {
  resetState();
  Bangle.setLCDMode(); 
  Bangle.setLCDTimeout(systemTimeout);
  load();
}

Bangle.on('GPS', onGPS);
Bangle.on('kill', cleanupAndExit);

// ---------------------------
// Initial Execution
// ---------------------------
g.clear();

loadSettings();
applyScreenTimeout();

Bangle.loadWidgets();
showStartMenu();



