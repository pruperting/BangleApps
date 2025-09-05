/*
 * CyclePlus: GPS Cycling Computer for Bangle.js 1
 */

// Load utils and settings
const utils = require("cycleplus.utils.js");
let settings = require('Storage').readJSON("cycleplus.json", true) |

| {};

// Constants
const ROTATION_MAP = ; // Map menu index  to rotation value 
let currentRotation = ROTATION_MAP[settings.rotation |

| 0];

// Application State
let rideState = {
  isActive: false, isPaused: false,
  startTime: 0, duration: 0,
  distance: 0, currentSpeed: 0, maxSpeed: 0,
  track:, lastFix: {}
};

let ghostRideState = null; // To hold data for comparison ride
let lastPauseTime = 0;
let durationInterval;
let timeInterval;

// --- UI Drawing Functions ---
function draw() {
  g.setRotation(currentRotation);
  g.reset().clear();
  Bangle.drawWidgets();

  if (!rideState.isActive &&!rideState.isPaused) {
    drawMainMenu();
    return;
  }

  // Main Ride UI
  drawMetrics();
  drawMap();
  drawTime();
}

function drawMainMenu() {
  g.setFont("Vector", 20).setFontAlign(0, 0);
  g.drawString("CyclePlus", g.getWidth()/2, 40);
  g.setFont("6x8", 2);
  g.drawString("BTN2 to Start", g.getWidth()/2, 100);
  g.drawString("BTN1/3 for Menu", g.getWidth()/2, 140);
}

function drawMetrics() {
  // Current Speed
  g.setFontAlign(0, 0).setFont("Vector", 50);
  g.drawString(rideState.currentSpeed.toFixed(1), g.getWidth()/2, 60);
  g.setFont("6x8", 1).drawString("km/h", g.getWidth()/2, 90);

  // Distance and Max Speed
  g.setFontAlign(-1, 0).setFont("Vector", 20);
  g.drawString(`Dist: ${rideState.distance.toFixed(2)}`, 10, 120);
  g.setFontAlign(1, 0);
  g.drawString(`Max: ${rideState.maxSpeed.toFixed(1)}`, g.getWidth() - 10, 120);

  // Duration
  let h = Math.floor(rideState.duration / 3600);
  let m = Math.floor((rideState.duration % 3600) / 60);
  let s = rideState.duration % 60;
  let durStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  g.setFontAlign(0, 0).setFont("Vector", 20);
  g.drawString(durStr, g.getWidth()/2, 220);

  if (rideState.isPaused) {
    g.setFont("Vector", 30).setColor(1,0,0).drawString("PAUSED", g.getWidth()/2, 160);
  }
}

function drawMap() {
  // This is a complex function involving bounding box calculation and projection
  // as described in Section 5.2. For brevity, a simplified version is shown.
  const mapRect = {x:20, y:150, w:200, h:60};
  g.drawRect(mapRect);
  
  if (rideState.track.length < 2) return;

  // In a full implementation, calculate scale and offset here
  let projectedTrack = rideState.track.map(p => {
    // Placeholder projection
    return {x: mapRect.x + (p.lon - rideState.track.lon) * 10000, 
            y: mapRect.y + mapRect.h - (p.lat - rideState.track.lat) * 10000};
  });

  g.setColor(g.theme.fg);
  g.drawPoly(projectedTrack, false);
}

function drawTime() {
    let d = new Date();
    let h = d.getHours(), m = d.getMinutes();
    let time = ("0"+h).substr(-2) + ":" + ("0"+m).substr(-2);
    g.setFont("6x8", 2).setFontAlign(1, -1);
    g.drawString(time, g.getWidth()-1, 24);
}


// --- GPS Handling ---
function handleGPS(fix) {
  if (!rideState.isActive |

| rideState.isPaused) return;

  if (fix.fix &&!isNaN(fix.lat)) {
    rideState.currentSpeed = fix.speed;
    rideState.maxSpeed = Math.max(rideState.maxSpeed, fix.speed);

    if (rideState.lastFix.lat!== undefined) {
      const dist = utils.haversine(rideState.lastFix.lat, rideState.lastFix.lon, fix.lat, fix.lon);
      // Add to track only if moved a certain distance
      if (dist > 0.01) { // 10 meters
        rideState.distance += dist;
        rideState.track.push({lat: fix.lat, lon: fix.lon});
      }
    } else {
      rideState.track.push({lat: fix.lat, lon: fix.lon});
    }
    rideState.lastFix = fix;
  } else {
    rideState.currentSpeed = 0;
  }
  draw();
}

// --- Ride Lifecycle Functions ---
function startRide() {
  rideState = {
    isActive: true, isPaused: false,
    startTime: Date.now(), duration: 0,
    distance: 0, currentSpeed: 0, maxSpeed: 0,
    track:, lastFix: {}
  };
  Bangle.setGPSPower(1, "cycleplus");
  durationInterval = setInterval(() => {
    if (rideState.isActive &&!rideState.isPaused) rideState.duration++;
  }, 1000);
  draw();
}

function pauseRide() {
  rideState.isPaused = true;
  lastPauseTime = Date.now();
  Bangle.setGPSPower(0, "cycleplus");
  draw();
}

function resumeRide() {
  rideState.isPaused = false;
  // Adjust start time for pause duration
  rideState.startTime += (Date.now() - lastPauseTime);
  Bangle.setGPSPower(1, "cycleplus");
  draw();
}

function stopRide() {
  E.showPrompt("Stop and Save Ride?").then(v => {
    if (v) {
      rideState.isActive = false;
      Bangle.setGPSPower(0, "cycleplus");
      if (durationInterval) clearInterval(durationInterval);
      saveRide();
      // Reset to main menu
      rideState = { isActive: false, isPaused: false };
      draw();
    }
  });
}

function saveRide() {
  const rideData = {
    startTime: rideState.startTime,
    duration: rideState.duration,
    distance: rideState.distance,
    maxSpeed: rideState.maxSpeed,
    track: rideState.track
  };
  const filename = `cycleplus.${rideData.startTime}.json`;
  require("Storage").write(filename, JSON.stringify(rideData));
  manageRideHistory();
}

function manageRideHistory() {
  let files = require("Storage").list(/^cycleplus\..*\.json$/).sort();
  while (files.length > 5) {
    require("Storage").erase(files.shift());
  }
}

// --- History Menu ---
function showHistoryMenu() {
    let files = require("Storage").list(/^cycleplus\..*\.json$/).sort().reverse();
    const menu = {
        '': { 'title': 'Ride History' },
        '< Back': () => { setupControls(); draw(); }
    };
    if (files.length === 0) {
        menu = ()=>{};
    }
    files.forEach(file => {
        let ts = parseInt(file.substring(11, file.length-5));
        let d = new Date(ts);
        let dateStr = `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')}`;
        menu = () => {
            // Load and display the ride (feature for comparison)
            ghostRideState = require("Storage").readJSON(file, true);
            E.showMessage("Ghost ride loaded!");
            setupControls();
            draw();
        };
    });
    E.showMenu(menu);
}


// --- Controls and Initialization ---
function setupControls() {
  Bangle.setUI("updown", btn => {
    if (rideState.isActive |

| rideState.isPaused) {
      // Ride controls
      if (btn === 0) { // BTN2
        rideState.isPaused? resumeRide() : pauseRide();
      }
    } else {
      // Main menu controls
      if (btn === 0) startRide();
      if (btn!== 0) showHistoryMenu();
    }
  });
}

function cleanUp() {
  Bangle.setGPSPower(0, "cycleplus");
  if (durationInterval) clearInterval(durationInterval);
  if (timeInterval) clearInterval(timeInterval);
  Bangle.removeListener('GPS', handleGPS);
}

// Initial Setup
g.clear();
Bangle.loadWidgets();
Bangle.drawWidgets();

Bangle.on('GPS', handleGPS);
setWatch(stopRide, BTN2, {repeat:false, edge:"falling", timeout:1000}); // Long press to stop
Bangle.on('kill', cleanUp); // Ensure GPS is off when app is closed

setupControls();
draw();
timeInterval = setInterval(drawTime, 60000);
