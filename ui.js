document.getElementById('fileInput').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    currentFile = file;
    lastTextContent = '';
    lastParsedPoints = [];

    const text = await currentFile.text();
    const points = extractGpsPointsFromText(text);
    if (!points.length) return alert("No GPS points found.");
    lastTextContent = text;
    lastParsedPoints = points;

    // Setup initial bounds and center
    currentBounds = calculateBounds(points);
    centerReference = calculateCenter(currentBounds);

    init(points, currentBounds, centerReference);

    if (liveUpdateInterval) clearInterval(liveUpdateInterval);
    liveUpdateInterval = setInterval(loadAndAppendNewData, 2000);
});
