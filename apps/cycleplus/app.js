/*
 * =============================================================
 * Cycle Plus - v9.2 (Save Fail-Safe)
 * =============================================================
 * A GPS cycling computer with ghost race and commute tracking.
 *
 * - CRITICAL FIX: The app no longer crashes to a black screen
 * if a user tries to save a ride with no recorded GPS data.
 * It now displays a clear error message and returns safely
 * to the main menu.
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
let lastPointForDistance;
let rideType = "";
let ghostTrack = [];
let distTimeDiff = 0;
let locTimeDiff = 0;
let drawInterval;
let lastGhostUpdateTime = 0;

// ---------------------------
// Ghost Ride & Storage Logic
// ---------------------------
function loadGhost(type) {
  let fileName = `cycleplus.${type}.json`;
  let data = storage.readJSON(fileName, true);
  ghostTrack = (data && data.track) ? data.track : [];
}

// --- Asynchronous save process with manual UI feedback ---
function saveRide(type) {
  print("LOG: saveRide() function started.");
  let tmpFile = storage.open(RIDE_FILE, "r");

  // --- CRITICAL FIX: Handle the "no data" case gracefully ---
  if (!tmpFile || tmpFile.getLength() === 0) {
    print("LOG: No ride data to save. Displaying message and returning to menu.");
    Bangle.setLCDMode("doublebuffered");
    g.clear();
    g.setFont("Vector", 20).setFontAlign(0, 0);
    g.drawString("No Ride Data", g.getWidth() / 2, g.getHeight() / 2 - 15);
    g.drawString("Not Saved", g.getWidth() / 2, g.getHeight() / 2 + 15);
    g.flip();
    setTimeout(() => {
        resetState();
        showStartMenu();
    }, 2000);
    return;
  }
  // --- End of critical fix ---
  
  print("LOG: Ride data found. Preparing to save.");

  Bangle.setLCDMode("doublebuffered");
  print("LOG: LCD mode set to doublebuffered.");
  g.clear();
  g.setFont("Vector", 20).setFontAlign(0, 0);
  g.drawString("Saving Ride...", g.getWidth() / 2, g.getHeight() / 2);
  g.flip();
  print("LOG: Drew 'Saving Ride...' message and flipped screen.");

  let finalFileName = `cycleplus.${type}.json`;
  storage.erase(finalFileName);
  let finalFile = storage.open(finalFileName, "a");

  finalFile.write(`{"duration":${getTime() - startTime},"track":[`);
  
  let firstLine = true;

  function processChunk() {
    print("LOG: processChunk started.");
    let linesProcessed = 0;
    while (linesProcessed < 20) {
      let line = tmpFile.readLine();
      if (line === undefined) {
        finalFile.write("]}");
        print("LOG: Finished writing file. Drawing 'Ride Saved'.");
        
        g.clear();
        g.setFont("Vector", 20).setFontAlign(0, 0);
        g.drawString("Ride Saved", g.getWidth() / 2, g.getHeight() / 2);
        g.flip();
        print("LOG: Drew 'Ride Saved' message and flipped screen.");

        setTimeout(() => {
          print("LOG: Resetting state and showing start menu.");
          resetState();
          showStartMenu();
        }, 1500);
        return;
      }

      if (!firstLine) finalFile.write(",");
      
      let parts = line.split(",");
      finalFile.write(`{"lat":${parts[0]},"lon":${parts[1]},"time":${parts[2]},"dist":${parts[3]}}`);
      firstLine = false;
      linesProcessed++;
    }
    print("LOG: Finished a chunk. Scheduling next chunk.");
    setTimeout(processChunk, 1);
  }
  
  print("LOG: Starting initial processChunk.");
  processChunk();
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
  lastPointForDistance = undefined;
  storage.erase(RIDE_FILE);
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
  print("LOG: stopRide() called.");
  isRunning = false;
  if (drawInterval) clearInterval(drawInterval);
  drawInterval = undefined;

  const saveMenu = {
    "": { "title": "Ride Paused" },
    "Continue Ride": () => {
      E.showMenu();
      Bangle.setLCDMode("doublebuffered");
      isRunning = true;
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
    print("LOG: 'Save as' menu item selected.");
    E.showMenu();
    print("LOG: E.showMenu() called to hide menu.");
    setTimeout(() => {
        print("LOG: setTimeout callback fired. Calling saveRide...");
        saveRide(rideType);
    }, 50);
  };
  
  print("LOG: Showing 'Ride Paused' menu.");
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

  const topY = 12;
  g.setFont("Vector", 20).setColor(g.theme.fg);
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

  const midY = g.getHeight() / 2 + 10;
  let speed = lastFix.speed.toFixed(1);
  g.setFont("Vector", 80).setFontAlign(0, 0);
  g.drawString(speed, g.getWidth() / 3, midY);

  let distStr = distance.toFixed(1);
  g.setFont("Vector", 40).setFontAlign(0, 0);
  g.drawString(distStr, g.getWidth() * 5 / 6, midY);
  g.setFont("6x8", 2).setFontAlign(0, 0);
  g.drawString("km", g.getWidth() * 5 / 6, midY + 30);
  
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
  Bangle.setUI({
    mode: "custom",
    btn: stopRide
  });
}

function cleanupAndExit() {
  resetState();
  Bangle.setLCDMode(); 
  Bangle.setLCDTimeout(systemTimeout);
  Bangle.setUI();
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

