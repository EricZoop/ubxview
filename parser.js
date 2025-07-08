// parser.js (browser-compatible)

function dmsToDd(dms, direction) {
    if (!dms) return null;
    const degrees = Math.floor(parseFloat(dms) / 100);
    const minutes = parseFloat(dms) % 100;
    let dd = degrees + minutes / 60;
    return (direction === 'S' || direction === 'W') ? -dd : dd;
}

function parseGNGGA(sentence) {
    const parts = sentence.split(',');
    if (parts[0] !== '$GNGGA' || parts.length < 10 || parts[6] === '0') return null;

    const lat = dmsToDd(parts[2], parts[3]);
    const lon = dmsToDd(parts[4], parts[5]);
    const alt = parseFloat(parts[9]) || 0;
    const timestamp = parts[1];

    if (lat === null || lon === null || !timestamp) return null;

    return { timestamp, lat, lon, alt };
}

/**
 * Accepts raw text from a .ubx or NMEA-style file
 * @param {string} rawData - The contents of the GPS log file
 * @returns {Array<{timestamp: string, lat: number, lon: number, alt: number}>}
 */
export function extractGpsPointsFromText(rawData) {
    const gnggaSentences = rawData.match(/\$GNGGA.*?\*[0-9A-Fa-f]{2}/g) || [];
    return gnggaSentences
        .map(parseGNGGA)
        .filter(p => p !== null);
}
