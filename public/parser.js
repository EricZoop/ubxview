/**
 * Parses text content to find and convert GNGGA/GPGGA sentences into structured points.
 * @param {string} text The raw text content from the file.
 * @returns {Array<{lat: number, lon: number, alt: number}>} An array of GPS points.
 */
export function extractGpsPointsFromText(text) {
    const points = [];

    // Clean up any weird characters (binary, BOM, etc.) and normalize line endings
    const cleanedText = text
        .replace(/[^\x20-\x7E\r\n$]/g, '') // Remove non-printable characters
        .replace(/\r\n|\r/g, '\n')         // Normalize newlines
        .replace(/\n{2,}/g, '\n');         // Remove excessive blank lines

    // Attempt to extract all GGA-like sentences using regex (more robust than split)
    const ggaRegex = /\$(?:GPGGA|GNGGA),[^\r\n]*?\*[0-9A-Fa-f]{2}/g;
    const matches = cleanedText.match(ggaRegex);

    if (!matches) return points;

    for (const sentence of matches) {
        const parts = sentence.split(',');

        if (parts.length < 12) continue; // need at least 12 to get undulation

        try {
            const latStr = parts[2];
            const latDir = parts[3];
            const lonStr = parts[4];
            const lonDir = parts[5];
            const altStr = parts[9];
            const undulationStr = parts[11];

            if (!latStr || !latDir || !lonStr || !lonDir || !altStr) continue;

            const latDeg = parseFloat(latStr.substring(0, 2));
            const latMin = parseFloat(latStr.substring(2));
            let lat = latDeg + latMin / 60;
            if (latDir === 'S') lat = -lat;

            const lonDeg = parseFloat(lonStr.substring(0, 3));
            const lonMin = parseFloat(lonStr.substring(3));
            let lon = lonDeg + lonMin / 60;
            if (lonDir === 'W') lon = -lon;

            let alt = parseFloat(altStr);
            const undulation = parseFloat(undulationStr);

            // Apply undulation correction if undulation is a valid number
            if (!isNaN(undulation)) {
                alt = undulation < 0 ? alt + undulation : alt - undulation;
            }

            if (!isNaN(lat) && !isNaN(lon) && !isNaN(alt)) {
                points.push({ lat, lon, alt });
            }
        } catch {
            continue;
        }
    }

    return points;
}
