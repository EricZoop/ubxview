// main.js - This file contains your renderer logic.
// It imports the parser, so it's loaded as a module in index.html.

import { extractGpsPointsFromText } from './parser.js';

let rendererInstance = null;
let labelRendererInstance = null;
let compassLabels = [];

function init(points, bounds, center) {
    // Cleanup previous scene to allow loading new files
    if (rendererInstance) {
        document.body.removeChild(rendererInstance.domElement);
        rendererInstance.dispose();
    }
    if (labelRendererInstance) {
        document.body.removeChild(labelRendererInstance.domElement);
    }
    compassLabels.forEach(el => el.element.remove());
    compassLabels = [];

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050505);

    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 50000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);
    rendererInstance = renderer;

    // THREE.CSS2DRenderer is available globally from the script tag in index.html
    const labelRenderer = new THREE.CSS2DRenderer();
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.top = '0px';
    labelRenderer.domElement.style.pointerEvents = 'none';
    document.body.appendChild(labelRenderer.domElement);
    labelRendererInstance = labelRenderer;

    // --- Camera Controls ---
    let isMouseDown = false;
    let isPanning = false;
    let mouseX = 0, mouseY = 0;
    let cameraDistance = 1000;
    let cameraAngleX = Math.PI / 6;
    let cameraAngleY = Math.PI / 4;
    let panOffset = new THREE.Vector3(0, 0, 0);

    function updateCameraPosition() {
        const x = Math.cos(cameraAngleY) * Math.cos(cameraAngleX) * cameraDistance;
        const y = Math.sin(cameraAngleX) * cameraDistance;
        const z = Math.sin(cameraAngleY) * Math.cos(cameraAngleX) * cameraDistance;
        camera.position.set(x + panOffset.x, y + panOffset.y, z + panOffset.z);
        camera.lookAt(panOffset.x, panOffset.y, panOffset.z);
    }

    document.addEventListener('mousedown', (e) => {
        isMouseDown = true;
        isPanning = e.shiftKey || e.button === 1; // Middle mouse button also pans
        mouseX = e.clientX;
        mouseY = e.clientY;
        if (e.button === 1) e.preventDefault(); // Prevent default middle-click scroll
    });
    document.addEventListener('mouseup', () => {
        isMouseDown = false;
        isPanning = false;
    });
    document.addEventListener('mousemove', (e) => {
        if (!isMouseDown) return;
        const deltaX = e.clientX - mouseX;
        const deltaY = e.clientY - mouseY;

        if (isPanning) {
            const panSpeed = cameraDistance * 0.001;
            const cameraDir = new THREE.Vector3();
            camera.getWorldDirection(cameraDir);
            const cameraRight = new THREE.Vector3().crossVectors(cameraDir, new THREE.Vector3(0, 1, 0)).normalize();
            const cameraUp = new THREE.Vector3().crossVectors(cameraRight, cameraDir).normalize();
            panOffset.add(cameraRight.multiplyScalar(-deltaX * panSpeed));
            panOffset.add(cameraUp.multiplyScalar(deltaY * panSpeed));
        } else {
            cameraAngleY += deltaX * 0.01;
            cameraAngleX += deltaY * 0.01;
            cameraAngleX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, cameraAngleX)); // Clamp vertical rotation
        }

        mouseX = e.clientX;
        mouseY = e.clientY;
        updateCameraPosition();
    });

    document.addEventListener('wheel', (e) => {
        cameraDistance += e.deltaY * 0.5;
        cameraDistance = Math.max(50, cameraDistance); // Prevent zooming too close
        updateCameraPosition();
    });

    document.addEventListener('contextmenu', (e) => e.preventDefault());

    // --- Scene Setup ---
    scene.add(new THREE.AmbientLight(0x404040, 1));
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(100, 100, 50);
    scene.add(directionalLight);

    const scaleFactor = 10.0;
    function gpsToCartesian(lat, lon, alt) {
        const centerLatRad = center.lat * Math.PI / 180;
        const x = ((lon - center.lon) * Math.cos(centerLatRad) * 111320) * scaleFactor;
        const y = (alt - center.alt) * 5; // Vertical exaggeration
        const z = ((lat - center.lat) * 111320) * scaleFactor;
        return new THREE.Vector3(x, y, -z); // Negate Z to align with compass
    }

    const positions = [];
    const colors = [];
    points.forEach(p => {
        const pos = gpsToCartesian(p.lat, p.lon, p.alt);
        positions.push(pos.x, pos.y, pos.z);
        const altRatio = (p.alt - bounds.minAlt) / (bounds.maxAlt - bounds.minAlt) || 0;
        const color = new THREE.Color().setHSL(0.7 - altRatio * 0.7, 1.0, 0.8); // Color by altitude
        colors.push(color.r, color.g, color.b);
    });

    const pointGeometry = new THREE.BufferGeometry();
    pointGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    pointGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    scene.add(new THREE.Points(pointGeometry, new THREE.PointsMaterial({
        size: 4, vertexColors: true, sizeAttenuation: false
    })));

    scene.add(new THREE.Line(pointGeometry, new THREE.LineBasicMaterial({ color: 0x00ff88 })));

    const dataSpan = Math.max(
        (bounds.maxLat - bounds.minLat) * 111320,
        (bounds.maxLon - bounds.minLon) * 111320
    );
    const gridSize = Math.max(1000, dataSpan * 1.2);

    const gridMaterial = new THREE.ShaderMaterial({
        uniforms: { uGridColor: { value: new THREE.Color(0x444444) } },
        vertexShader: `
            varying vec3 vWorldPos;
            void main() {
                vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                vWorldPos = worldPosition.xyz;
                gl_Position = projectionMatrix * viewMatrix * worldPosition;
            }
        `,
        fragmentShader: `
            uniform vec3 uGridColor;
            varying vec3 vWorldPos;
            void main() {
                float gridSize = 100.0;
                float lineWidth = 0.5;
                vec2 coord = vWorldPos.xz / gridSize;
                vec2 grid = abs(fract(coord - 0.5) - 0.5) / fwidth(coord);
                float line = min(grid.x, grid.y);
                float alpha = 1.0 - smoothstep(0.0, lineWidth, line);
                gl_FragColor = vec4(uGridColor, alpha);
            }
        `,
        transparent: true,
    });

    const gridPlane = new THREE.Mesh(new THREE.PlaneGeometry(100000, 100000), gridMaterial);
    gridPlane.rotation.x = -Math.PI / 2;
    scene.add(gridPlane);
    scene.add(new THREE.AxesHelper(gridSize / 2));

    function createAxisLabel(text, position) {
        const div = document.createElement('div');
        div.className = 'compass-label'; // You will need to style this in your style.css
        div.textContent = text;
        const label = new THREE.CSS2DObject(div);
        label.position.copy(position);
        scene.add(label);
        compassLabels.push(label);
    }

    const labelDist = gridSize / 2 * 1.05;
    const centerVec = gpsToCartesian(center.lat, center.lon, center.alt);
    createAxisLabel('N', centerVec.clone().add(new THREE.Vector3(0, 0, -labelDist)));
    createAxisLabel('S', centerVec.clone().add(new THREE.Vector3(0, 0, labelDist)));
    createAxisLabel('E', centerVec.clone().add(new THREE.Vector3(labelDist, 0, 0)));
    createAxisLabel('W', centerVec.clone().add(new THREE.Vector3(-labelDist, 0, 0)));

    cameraDistance = Math.max(dataSpan * 1.5, 200);
    updateCameraPosition();

    function animate() {
        requestAnimationFrame(animate);
        renderer.render(scene, camera);
        labelRenderer.render(scene, camera);
    }
    animate();

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        labelRenderer.setSize(window.innerWidth, window.innerHeight);
    });

    console.log("Renderer initialized.");
}

// --- File Input Setup ---
document.getElementById('fileInput').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const fileLabel = document.getElementById('fileLabel');
    if (fileLabel) {
        // Just show the filename, not the whole SVG again
        fileLabel.innerHTML = file.name;
    }

    const text = await file.text();
    const points = extractGpsPointsFromText(text);
    if (!points.length) {
        alert("No valid GPS points found in the file.");
        return;
    }

    const bounds = points.reduce((acc, p) => ({
        minLat: Math.min(acc.minLat, p.lat), maxLat: Math.max(acc.maxLat, p.lat),
        minLon: Math.min(acc.minLon, p.lon), maxLon: Math.max(acc.maxLon, p.lon),
        minAlt: Math.min(acc.minAlt, p.alt), maxAlt: Math.max(acc.maxAlt, p.alt),
    }), {
        minLat: Infinity, maxLat: -Infinity, minLon: Infinity, maxLon: -Infinity,
        minAlt: Infinity, maxAlt: -Infinity,
    });

    const center = {
        lat: (bounds.minLat + bounds.maxLat) / 2,
        lon: (bounds.minLon + bounds.maxLon) / 2,
        alt: (bounds.minAlt + bounds.maxAlt) / 2,
    };

    init(points, bounds, center);
});
