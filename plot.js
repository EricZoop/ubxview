const fs = require('fs');
const nmea = require('nmea-simple');

// --- 1. Read and Clean the File ---
const rawData = fs.readFileSync('jirun2.ubx', 'utf8');
const gnggaSentences = rawData.match(/\$GNGGA.*?\*[0-9A-Fa-f]{2}/g) || [];
console.log(`Found ${gnggaSentences.length} potential GNGGA sentences.`);

// --- 2. Parse Valid Data Points (Manual GNGGA parsing) ---
const points = [];

function parseGNGGA(sentence) {
    // Manual GNGGA parsing since nmea-simple might be too strict
    const parts = sentence.split(',');
    
    if (parts.length < 15 || parts[0] !== '$GNGGA') {
        return null;
    }
    
    const timestamp = parts[1];
    const latRaw = parts[2];
    const latDir = parts[3];
    const lonRaw = parts[4];
    const lonDir = parts[5];
    const fixType = parseInt(parts[6]) || 0;
    const numSats = parseInt(parts[7]) || 0;
    const hdop = parseFloat(parts[8]) || 0;
    const altRaw = parts[9];
    const altUnit = parts[10];
    
    // Skip if no GPS fix or missing coordinates
    if (fixType === 0 || !latRaw || !lonRaw || latRaw === '' || lonRaw === '') {
        return null;
    }
    
    // Convert DDMM.MMMMM format to decimal degrees
    function dmsToDd(dms, direction) {
        if (!dms || dms === '') return null;
        const degrees = Math.floor(parseFloat(dms) / 100);
        const minutes = parseFloat(dms) % 100;
        let dd = degrees + minutes / 60;
        if (direction === 'S' || direction === 'W') {
            dd = -dd;
        }
        return dd;
    }
    
    const lat = dmsToDd(latRaw, latDir);
    const lon = dmsToDd(lonRaw, lonDir);
    const alt = parseFloat(altRaw) || 0;
    
    if (lat === null || lon === null) {
        return null;
    }
    
    return {
        timestamp,
        lat,
        lon,
        alt,
        fixType,
        numSats,
        hdop
    };
}

gnggaSentences.forEach((sentence, index) => {
    const parsed = parseGNGGA(sentence);
    if (parsed) {
        points.push(parsed);
    }
});

console.log('Sample parsed data:', points.slice(0, 3));

console.log(`Extracted ${points.length} valid data points.`);
if (points.length === 0) {
    console.log("No valid GPS data to plot. Exiting.");
    process.exit();
}

// --- 3. Calculate Bounds and Center ---
const bounds = points.reduce((acc, p) => {
    acc.minLat = Math.min(acc.minLat, p.lat);
    acc.maxLat = Math.max(acc.maxLat, p.lat);
    acc.minLon = Math.min(acc.minLon, p.lon);
    acc.maxLon = Math.max(acc.maxLon, p.lon);
    acc.minAlt = Math.min(acc.minAlt, p.alt);
    acc.maxAlt = Math.max(acc.maxAlt, p.alt);
    return acc;
}, {
    minLat: Infinity, maxLat: -Infinity,
    minLon: Infinity, maxLon: -Infinity,
    minAlt: Infinity, maxAlt: -Infinity
});

const center = {
    lat: (bounds.minLat + bounds.maxLat) / 2,
    lon: (bounds.minLon + bounds.maxLon) / 2,
    alt: (bounds.minAlt + bounds.maxAlt) / 2
};

console.log('Dataset bounds:', bounds);
console.log('Dataset center:', center);

// --- 4. Generate the Enhanced HTML ---
const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <title>Enhanced GNGGA 3D Plot</title>
    <style>
        body { 
            margin: 0; 
            background: linear-gradient(135deg, #0c0c0c 0%, #1a1a2e 100%);
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            overflow: hidden;
        }
        canvas { display: block; }
        #info {
            position: absolute; 
            top: 20px; 
            left: 20px;
            color: #ffffff; 
            background: rgba(0,0,0,0.7);
            padding: 15px;
            border-radius: 8px;
            font-size: 14px;
            line-height: 1.4;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255,255,255,0.1);
        }
        #stats {
            position: absolute;
            top: 20px;
            right: 20px;
            color: #ffffff;
            background: rgba(0,0,0,0.7);
            padding: 15px;
            border-radius: 8px;
            font-size: 12px;
            line-height: 1.4;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255,255,255,0.1);
        }
        .highlight { color: #00ff88; }
        .warning { color: #ffaa00; }
    </style>
</head>
<body>
    <div id="info">
        <div style="font-size: 16px; font-weight: bold; margin-bottom: 10px;">🛰️ GNGGA 3D GPS Plot</div>
        <div><span class="highlight">Yellow Cube:</span> Reference Point</div>
        <div><span class="highlight">Colored Points:</span> GPS Data</div>
        <div style="margin-top: 8px;">
            <div>🖱️ Drag to rotate</div>
            <div>🔄 Scroll to zoom</div>
            <div>📍 Middle click to pan</div>
        </div>
    </div>
    
    <div id="stats">
        <div><strong>Dataset Stats:</strong></div>
        <div>Points: <span class="highlight">${points.length}</span></div>
        <div>Lat Range: <span class="highlight">${bounds.minLat.toFixed(6)}° to ${bounds.maxLat.toFixed(6)}°</span></div>
        <div>Lon Range: <span class="highlight">${bounds.minLon.toFixed(6)}° to ${bounds.maxLon.toFixed(6)}°</span></div>
        <div>Alt Range: <span class="highlight">${bounds.minAlt.toFixed(1)}m to ${bounds.maxAlt.toFixed(1)}m</span></div>
        <div>Center: <span class="highlight">${center.lat.toFixed(6)}°, ${center.lon.toFixed(6)}°</span></div>
    </div>
    
    <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
    <script>
        // --- Injected Data ---
        const points = ${JSON.stringify(points)};
        const bounds = ${JSON.stringify(bounds)};
        const center = ${JSON.stringify(center)};
        
        // --- Reference Point (you can modify this) ---
        const referencePoint = { 
            lat: ${center.lat}, 
            lon: ${center.lon}, 
            alt: ${center.alt}
        };

        // --- Scene Setup ---
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x050505);
        
        const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 50000);
        
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        document.body.appendChild(renderer.domElement);
        
        // --- Simple Mouse Controls (replacing OrbitControls) ---
        let mouseX = 0, mouseY = 0;
        let isMouseDown = false;
        let cameraDistance = 1000;
        let cameraAngleX = 0;
        let cameraAngleY = 0;
        
        function updateCameraPosition() {
            const x = Math.cos(cameraAngleY) * Math.cos(cameraAngleX) * cameraDistance;
            const y = Math.sin(cameraAngleX) * cameraDistance;
            const z = Math.sin(cameraAngleY) * Math.cos(cameraAngleX) * cameraDistance;
            camera.position.set(x, y, z);
            camera.lookAt(0, 0, 0);
        }
        
        document.addEventListener('mousedown', (event) => {
            isMouseDown = true;
            mouseX = event.clientX;
            mouseY = event.clientY;
        });
        
        document.addEventListener('mouseup', () => {
            isMouseDown = false;
        });
        
        document.addEventListener('mousemove', (event) => {
            if (!isMouseDown) return;
            
            const deltaX = event.clientX - mouseX;
            const deltaY = event.clientY - mouseY;
            
            cameraAngleY += deltaX * 0.01;
            cameraAngleX += deltaY * 0.01;
            
            // Limit vertical rotation
            cameraAngleX = Math.max(-Math.PI/2, Math.min(Math.PI/2, cameraAngleX));
            
            mouseX = event.clientX;
            mouseY = event.clientY;
            
            updateCameraPosition();
        });
        
        
        // --- Lighting ---
        const ambientLight = new THREE.AmbientLight(0x404040, 0.4);
        scene.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(100, 100, 50);
        directionalLight.castShadow = true;
        scene.add(directionalLight);

        // --- Coordinate Transformation ---
        const scaleFactor = 1.0; // Increase scale factor
        
        function gpsToCartesian(lat, lon, alt) {
            // Convert GPS coordinates to local cartesian coordinates
            const centerLatRad = center.lat * Math.PI / 180;
            
            // Calculate relative position from center
            const deltaLat = lat - center.lat;
            const deltaLon = lon - center.lon;
            const deltaAlt = alt - center.alt;
            
            // Convert to approximate meters with larger scale
            const x = (deltaLon * Math.cos(centerLatRad) * 111320) * scaleFactor;
            const y = deltaAlt * 5; // Much more altitude exaggeration
            const z = (deltaLat * 111320) * scaleFactor;
            
            return new THREE.Vector3(x, y, -z);
        }

        // --- Create Reference Point (Much Larger) ---
        const referenceGeometry = new THREE.BoxGeometry(100, 100, 100); // 5x larger
        const referenceMaterial = new THREE.MeshLambertMaterial({ 
            color: 0xffff00,
            transparent: false,
            opacity: 1.0
        });
        const referenceCube = new THREE.Mesh(referenceGeometry, referenceMaterial);
        const refPos = gpsToCartesian(referencePoint.lat, referencePoint.lon, referencePoint.alt);
        referenceCube.position.copy(refPos);
        referenceCube.castShadow = true;
        scene.add(referenceCube);

        // --- Create GPS Data Points (Much Larger) ---
        const pointGeometry = new THREE.BufferGeometry();
        const positions = [];
        const colors = [];
        
        points.forEach(point => {
            const pos = gpsToCartesian(point.lat, point.lon, point.alt);
            positions.push(pos.x, pos.y, pos.z);
            
            // Color based on altitude
            const altRatio = (point.alt - bounds.minAlt) / (bounds.maxAlt - bounds.minAlt) || 0;
            const color = new THREE.Color();
            color.setHSL(0.7 - altRatio * 0.7, 1.0, 0.8);
            colors.push(color.r, color.g, color.b);
        });

        pointGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        pointGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

        const pointMaterial = new THREE.PointsMaterial({ 
            size: 15, // Much larger points
            vertexColors: true,
            transparent: false,
            opacity: 1.0,
            sizeAttenuation: false
        });
        
        const pointCloud = new THREE.Points(pointGeometry, pointMaterial);
        scene.add(pointCloud);

        // --- Create Path Line (Thicker) ---
        const pathGeometry = new THREE.BufferGeometry();
        pathGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        
        const pathMaterial = new THREE.LineBasicMaterial({ 
            color: 0x00ff88,
            transparent: false,
            opacity: 1.0,
            linewidth: 5
        });
        
        const pathLine = new THREE.Line(pathGeometry, pathMaterial);
        scene.add(pathLine);

        // --- Add Grid and Axes (Larger) ---
        const gridSize = Math.max(1000, 
            Math.abs(bounds.maxLat - bounds.minLat) * 111320 * scaleFactor * 2,
            Math.abs(bounds.maxLon - bounds.minLon) * 111320 * scaleFactor * 2
        );
        const gridHelper = new THREE.GridHelper(gridSize, 20, 0x444444, 0x444444);
        scene.add(gridHelper);
        
        const axesHelper = new THREE.AxesHelper(gridSize / 2);
        scene.add(axesHelper);
        // --- Position Camera ---
        const dataSpan = Math.max(
            Math.abs(bounds.maxLat - bounds.minLat) * 111320 * scaleFactor,
            Math.abs(bounds.maxLon - bounds.minLon) * 111320 * scaleFactor
        );
        
        cameraDistance = Math.max(dataSpan * 1.5, 200); // Closer camera
        cameraAngleX = Math.PI / 6; // Look down slightly
        cameraAngleY = Math.PI / 4; // Angle the view
        updateCameraPosition();

        // Add debugging info
        console.log('Data span:', dataSpan);
        console.log('Camera distance:', cameraDistance);
        console.log('Reference cube position:', refPos);
        console.log('Sample point positions:', positions.slice(0, 9)); // First 3 points (x,y,z each)

        // --- Animation Loop ---
        function animate() {
            requestAnimationFrame(animate);
            
            // Rotate reference cube
            referenceCube.rotation.x += 0.005;
            referenceCube.rotation.y += 0.01;
            
            renderer.render(scene, camera);
        }
        
        animate();

        // --- Window Resize Handler ---
        window.addEventListener('resize', () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        });

        // --- Log Info ---
        console.log('3D GPS Plot initialized');
        console.log('Points loaded:', points.length);
        console.log('Data bounds:', bounds);
        console.log('Reference point:', referencePoint);
    </script>
</body>
</html>
`;

fs.writeFileSync('plot.html', htmlContent, { encoding: 'utf8' });
console.log('✨ Enhanced plot created successfully!');
console.log('📊 Statistics:');
console.log(`   - Total points: ${points.length}`);
console.log(`   - Latitude range: ${bounds.minLat.toFixed(6)}° to ${bounds.maxLat.toFixed(6)}°`);
console.log(`   - Longitude range: ${bounds.minLon.toFixed(6)}° to ${bounds.maxLon.toFixed(6)}°`);
console.log(`   - Altitude range: ${bounds.minAlt.toFixed(1)}m to ${bounds.maxAlt.toFixed(1)}m`);
console.log('🌐 Open plot.html in your browser to view the 3D plot.');