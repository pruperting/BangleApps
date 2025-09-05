const R = 6371; // Earth's radius in kilometers

function degreesToRadians(deg) {
  return deg * (Math.PI / 180);
}

exports.haversine = function(lat1, lon1, lat2, lon2) {
  if (lat1 === undefined |

| lon1 === undefined |
| lat2 === undefined |
| lon2 === undefined) {
    return 0;
  }
  const dLat = degreesToRadians(lat2 - lat1);
  const dLon = degreesToRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(degreesToRadians(lat1)) * Math.cos(degreesToRadians(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in km
};
