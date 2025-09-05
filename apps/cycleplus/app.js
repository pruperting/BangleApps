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
