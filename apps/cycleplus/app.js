/*
 * =============================================================
 * Cycle Plus - v8.0 (Memory, UI & Bug Fixes)
 * =============================================================
 * A GPS cycling computer with ghost race and commute tracking.
 *
 * - CRITICAL FIX (Memory): Re-architected GPS tracking to save
 * the live track to flash storage instead of RAM, completely
 * solving the memory leak and crashes on long rides.
 * - FIX (Ghost Logic): Corrected a bug where the Distance-based
 * ghost value would always show 0s.
 * - UI OVERHAUL:
 * - Removed the non-functional breadcrumb trail.
 * - App now uses a full-screen immersive view that covers the
 * widget bar.
 * - Redesigned layout with larger time/duration at the top.
 * - Ghost and distance values are now properly rounded for a
 * cleaner display.
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
const RIDE_FILE = "cycleplus.tmp.gps";
let settings;
let systemTimeout;

function loadSettings() {
  settings = storage.readJSON(SETTINGS_FILE, true) || { keepScreenOn: false };
  systemTimeout = (storage.readJSON("setting.json", 1) || {}).timeout;
}

function saveSettings() {
  storage.writeJSON(SETTINGS_FILE, settings);
}

function applyScreenTimeout() {
  Bangle.setLCDTimeout(settings.keepScreenOn ? 0 : systemTimeout);
}

// ---------------------------
// App State
// ---------------------------
let isRunning = false;
let startTime = 0;
let distance = 0;
let lastFix = { fix: 0, speed: 0 };
let lastPointForDistance; // For live distance calculation without storing whole track in RAM
let rideType = "";
let ghostTrack = [];
let distTimeDiff = 0;
let locTimeDiff = 0;
let drawInterval;
let lastGhostUpdateTime = 0;
let stopRideWatch;

// ---------------------------
// Ghost Ride & Storage Logic
// ---------------------------
function loadGhost(type) {
  let fileName = `cycleplus.${type}.json`;
  let data = storage.readJSON(fileName, true);
  ghostTrack = (data && data.track) ? data.track : [];
}

function saveRide(type) {
  let tmpFile = storage.open(RIDE_FILE, "r");
  if (!tmpFile) return;

  let track = [];
  let line = tmpFile.readLine();
  while (line) {
    let parts = line.split(",");
    track.push({
      lat: parseFloat(parts[0]),
      lon: parseFloat(parts[1]),
      time: parseFloat(parts[2]),
      dist: parseFloat(parts[3])
    });
    line = tmpFile.readLine();
  }
  
  if (track.length < 2) return;

  let fileName = `cycleplus.${type}.json`;
  storage.writeJSON(fileName, {
    duration: getTime() - startTime,
    track: track
  });
}

function getGhostTimeAtCurrentDist() {
  if (ghostTrack.length < 2) return 0;
  for (let i = 1; i < ghostTrack.length; i++) {
    let p1 = ghostTrack[i - 1], p2 = ghostTrack[i];
    if (p1.dist <= distance && distance <= p2.dist) {
      let distSegment = p2.dist - p1.dist;
      if (distSegment <= 0) return p1.time;
      return p1.time + ((p2.time - p1.time) * ((distance - p1.dist) / distSegment));
    }
  }
  return 0;
}

function getGhostTimeAtCurrentLocation(fix) {
  if (ghostTrack.length < 2 || !fix.fix) return 0;
  let minDist = -1, closestPoint = null;
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
  ghostTrack = [];
  distTimeDiff = 0;
  locTimeDiff = 0;
  rideType = "";
  lastGhostUpdateTime = 0;
  stopRideWatch = undefined;
  lastPointForDistance = undefined;
  storage.erase(RIDE_FILE); // Clear temp ride data
  if (drawInterval) clearInterval(drawInterval);
  drawInterval = undefined;
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
  if (drawInterval) clearInterval(drawInterval);
  drawInterval = undefined;

  const saveMenu = {
    "": { "title": "Ride Paused" },
    "Continue Ride": () => {
      E.showMenu();
      Bangle.setLCDMode("doublebuffered");
      isRunning = true;
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
    lastGhostUpdateTime = getTime();
    lastPointForDistance = fix;
  }

  if (isRunning && fix.fix) {
    let currentElapsedTime = getTime() - startTime;
    if (fix.lat !== undefined && lastPointForDistance) {
      distance += haversine(lastPointForDistance.lat, lastPointForDistance.lon, fix.lat, fix.lon);
      storage.open(RIDE_FILE, "a").write([fix.lat, fix.lon, currentElapsedTime, distance].join(",") + "\n");
    }
    lastPointForDistance = fix;
    
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
  g.reset().clearRect(0, 0, g.getWidth(), g.getHeight());

  // Top Bar: Time and Duration
  const topY = 12;
  g.setFont("6x8", 3).setColor(g.theme.fg);
  let now = new Date();
  let timeStr = require("locale").time(now, 1);
  g.setFontAlign(-1, 0).drawString(timeStr, 4, topY);

  let durationStr = "00:00:00";
  if (startTime > 0) {
    let duration = getTime() - startTime;
    let hours = Math.floor(duration / 3600);
    let mins = Math.floor(duration / 60) % 60;
    let secs = Math.floor(duration % 60);
    durationStr = ("0" + hours).substr(-2) + ":" + ("0" + mins).substr(-2) + ":" + ("0" + secs).substr(-2);
  }
  g.setFontAlign(1, 0).drawString(durationStr, g.getWidth() - 4, topY);

  // Center Area: Speed and Distance
  const midY = g.getHeight() / 2 + 10;
  let speed = lastFix.speed.toFixed(1);
  g.setFont("Vector", 80).setFontAlign(0, 0);
  g.drawString(speed, g.getWidth() / 3, midY);

  let distStr = distance.toFixed(1);
  g.setFont("Vector", 40).setFontAlign(0, 0);
  g.drawString(distStr, g.getWidth() * 5 / 6, midY);
  g.setFont("6x8", 2).setFontAlign(0, 0);
  g.drawString("km", g.getWidth() * 5 / 6, midY + 30);
  
  // Bottom Bar: Ghost Data and GPS status
  const bottomY = g.getHeight() - 12;
  
  if (ghostTrack.length > 0 && isRunning) {
    g.setFont("6x8", 2);
    let distDiffStr = "D " + (distTimeDiff > 0 ? "+" : "") + Math.round(distTimeDiff) + "s";
    g.setColor(distTimeDiff > 0 ? "#f00" : "#0f0").setFontAlign(-1, 0);
    g.drawString(distDiffStr, 4, bottomY);

    let locDiffStr = "L " + (locTimeDiff > 0 ? "+" : "") + Math.round(locTimeDiff) + "s";
    g.setColor(locTimeDiff > 0 ? "#f00" : "#0f0").setFontAlign(1, 0);
    g.drawString(locDiffStr, g.getWidth() - 4, bottomY);
  }

  g.setFont("6x8", 2).setFontAlign(0, 0);
  if (lastFix.fix) g.setColor(0, 1, 0); else g.setColor(1, 0, 0);
  g.drawString("GPS", g.getWidth() / 2, bottomY);
  
  g.flip();
}

// ---------------------------
// Menus and UI Handling
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

function setUI() {
  Bangle.setUI("clockupdown", () => stopRide());
}

function cleanupAndExit() {
  resetState();
  Bangle.setLCDMode(); 
  Bangle.setLCDTimeout(systemTimeout);
  Bangle.setUI(); // Clear custom UI
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
showStartMenu();

