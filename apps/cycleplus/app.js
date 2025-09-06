/*
 * =============================================================
 * Cycle Plus - v3.3 (Menu Transition Fix)
 * =============================================================
 * A GPS cycling computer with ride saving and ghost comparison.
 *
 * - FIX: Corrected a menu transition error that caused a crash
 * when selecting an option from the 'Save Ride' menu. The app
 * now properly dismisses the current menu before showing the
 * next one.
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
let rideType = "";
let ghostTrack = [];
let timeDiff = 0; // in seconds
let drawInterval;

// ---------------------------
// Ghost Ride & Storage Logic
// ---------------------------
function loadGhost(type) {
  let fileName = `cycleplus.${type}.json`;
  let data = storage.readJSON(fileName, true);
  if (data && data.track) {
    ghostTrack = data.track;
    E.showMessage(`Loaded ${type} ride`, "Ghost Ready");
  } else {
    ghostTrack = [];
    E.showMessage(`No ${type} ride saved`, "No Ghost");
  }
}

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
}

function startRide(type) {
  if (drawInterval) {
    clearInterval(drawInterval);
    drawInterval = undefined;
  }
  clearWatch(); // Ensure no buttons are active

  resetState();
  rideType = type;
  loadGhost(type);
  Bangle.setGPSPower(1, "cycleplus");

  // Replace E.showScroller with a simple manual message draw.
  // This avoids using a complex UI component that manages its own input,
  // which was the source of the conflict.
  g.clear();
  g.setFont("6x8:2").setFontAlign(0, 0);
  g.drawString("Waiting for\nGPS signal...", g.getWidth() / 2, g.getHeight() / 2);
  g.flip(); // Display the message on the screen

  // No setWatch here. All buttons are disabled until a GPS fix is received.
}

function stopRide() {
  if (!isRunning) return;
  isRunning = false;
  Bangle.setGPSPower(0, "cycleplus");
  showSaveMenu();
}

function onGPS(fix) {
  lastFix = fix;
  if (!fix.fix) return;

  if (isRunning) {
    let currentElapsedTime = getTime() - startTime;
    if (fix.lat !== undefined) {
      let lastPoint = track.length > 0 ? track[track.length - 1] : null;
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
  } else if (rideType) {
    // This block runs ONCE on the very first GPS fix to start the ride.
    if (fix.lat !== undefined) {
      startTime = getTime();
      isRunning = true;

      // --- THIS IS THE FIX ---
      // We must explicitly tear down the "Waiting for GPS" scroller UI
      // before setting up the main ride UI. Calling E.showMenu() with
      // no arguments is a clean way to reset the screen and all button handlers.
      E.showMenu();

      // Now, with a clean slate, set up the button handlers for the main ride screen.
      setUI();

      // Start the drawing interval for the main ride screen.
      if (!drawInterval) {
        drawInterval = setInterval(draw, 1000);
      }
      draw(); // Draw immediately to prevent a blank screen before the first interval.

      // Add the first point to our track.
      track.push({ lat: fix.lat, lon: fix.lon, time: 0, dist: 0 });
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

  // GPS Trail (simplified)
  if (track.length > 1) {
    const trailRect = { x: 0, y: 120, w: g.getWidth(), h: g.getHeight() - 120 };
    g.setClipRect(trailRect.x, trailRect.y, trailRect.x + trailRect.w - 1, trailRect.y + trailRect.h - 1);
    let projectedTrack = track.map(p => Bangle.project(p));
    g.setColor("#0ff").drawPoly(projectedTrack, false);
    g.reset();
  }

  // Duration
  let durationStr = "00:00:00";
  if (isRunning || startTime > 0) {
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
let mainMenu, startMenu, saveMenu;

function onMenuHide() {
  // This function is called when we exit a menu, to restore the main UI
  if (!drawInterval) {
    drawInterval = setInterval(draw, 1000);
  }
  draw();
  setUI();
}

function showMainMenu() {
  if (drawInterval) {
    clearInterval(drawInterval);
    drawInterval = undefined;
  }
  clearWatch();
  E.showMenu(mainMenu, { onHide: onMenuHide });
}

function showStartMenu() {
  E.showMenu(startMenu, { onHide: onMenuHide });
}

function showSaveMenu() {
  if (drawInterval) {
    clearInterval(drawInterval);
    drawInterval = undefined;
  }
  clearWatch();
  E.showMenu(saveMenu, { onHide: onMenuHide });
}

mainMenu = {
  "": { "title": "Cycle Plus" },
  "Start Ride": showStartMenu,
  "Stop & Save": () => {
    if (!isRunning) {
      E.showMessage("Not started");
      showMainMenu();
    } else {
      stopRide();
    }
  },
  "Exit": () => load(),
};

startMenu = {
  "": { "title": "Start Ride" },
  "To Work": () => {
    E.showMenu(); // Clear menu before starting
    setTimeout(() => startRide("work"), 50);
  },
  "To Home": () => {
    E.showMenu(); // Clear menu before starting
    setTimeout(() => startRide("home"), 50);
  },
  "< Back": showMainMenu,
};

saveMenu = {
  "": { "title": "Save Ride" },
  "As Work Ride": () => {
    saveRide("work");
    resetState();
    E.showMenu(); // Dismiss the current (save) menu
    setTimeout(showMainMenu, 50); // Show the main menu after a short delay
  },
  "As Home Ride": () => {
    saveRide("home");
    resetState();
    E.showMenu(); // Dismiss the current (save) menu
    setTimeout(showMainMenu, 50); // Show the main menu after a short delay
  },
  "Don't Save": () => {
    resetState();
    E.showMenu(); // Dismiss the current (save) menu
    setTimeout(showMainMenu, 50); // Show the main menu after a short delay
  },
};

// ---------------------------
// Event Listeners & Init
// ---------------------------
Bangle.on('GPS', onGPS);

let pressTimeout;
function setUI() {
  clearWatch();
  // Long-press BTN2 to open the menu
  setWatch(() => {
    if (Bangle.isLCDOn()) {
      pressTimeout = setTimeout(showMainMenu, 2000);
    }
  }, BTN2, { repeat: true, edge: "rising" });

  setWatch(() => {
    if (pressTimeout) clearTimeout(pressTimeout);
  }, BTN2, { repeat: true, edge: "falling" });
}

// ---------------------------
// Initial Execution
// ---------------------------
g.clear();
Bangle.loadWidgets();
Bangle.drawWidgets();
resetState();
setUI();
drawInterval = setInterval(draw, 1000);



