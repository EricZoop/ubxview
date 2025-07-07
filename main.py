import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d import Axes3D
import numpy as np
from itertools import combinations, product
import os
import time

# ==== Stage Setup ====
# Observer (reference) coordinates in decimal degrees and meters
OBSERVER_LAT = 39.1961      
OBSERVER_LON = -77.2568    
OBSERVER_ALT = 130.0         # Meters above sea level
STAGE_RADIUS = 25.0         # Meters around the observer

# ==== GNGGA Parsing ====
def parse_gngga(line):
    """Parse GNGGA line with enhanced error handling"""
    try:
        # Additional validation before parsing
        if not is_valid_gngga_line(line):
            return None
            
        parts = line.split(',')
        if len(parts) < 10 or not parts[0].endswith("GGA"):
            return None

        lat_raw = parts[2]
        lat_dir = parts[3]
        lon_raw = parts[4]
        lon_dir = parts[5]
        alt_str = parts[9]
        utc_time = parts[1]

        # Skip if any critical field is empty
        if not lat_raw or not lat_dir or not lon_raw or not lon_dir or not alt_str:
            return None

        def convert(coord, direction):
            coord_val = float(coord)
            deg = int(coord_val / 100)
            minutes = coord_val - deg * 100
            decimal = deg + minutes / 60
            if direction in ['S', 'W']:
                decimal *= -1
            return decimal

        latitude = convert(lat_raw, lat_dir)
        longitude = convert(lon_raw, lon_dir)
        altitude = float(alt_str)

        # Additional sanity checks on converted values
        if not (-90 <= latitude <= 90):
            return None
        if not (-180 <= longitude <= 180):
            return None
        if not (-1000 <= altitude <= 10000):
            return None

        return (utc_time, latitude, longitude, altitude)
        
    except (ValueError, IndexError, TypeError) as e:
        # Log the problematic line for debugging
        print(f"Skipping invalid line: {line[:50]}... (Error: {e})")
        return None

# ==== Geospatial Conversion ====
def geo_to_xy(lat0, lon0, lat, lon):
    R = 6371000  # Earth radius in meters
    x = (lon - lon0) * np.pi / 180 * R * np.cos(lat0 * np.pi / 180)
    y = (lat - lat0) * np.pi / 180 * R
    return x, y

# ==== File Reading Functions ====
def read_latest_gnss_data(filename):
    """Read the latest GNSS data from file, handling live updates and corrupted data"""
    try:
        # Try multiple encodings to handle corrupted data
        encodings = ['utf-8', 'latin-1', 'cp1252', 'ascii']
        lines = []
        
        for encoding in encodings:
            try:
                with open(filename, "r", encoding=encoding, errors='ignore') as f:
                    raw_lines = f.readlines()
                    break
            except UnicodeDecodeError:
                continue
        else:
            # If all encodings fail, read as binary and filter
            with open(filename, "rb") as f:
                raw_data = f.read()
                # Convert to string, ignoring bad bytes
                raw_text = raw_data.decode('utf-8', errors='ignore')
                raw_lines = raw_text.split('\n')
        
        # Clean and filter lines
        valid_lines = []
        for line in raw_lines:
            line = line.strip()
            # Only process lines that start with $GNGGA and have reasonable length
            if line.startswith('$GNGGA') and len(line) > 50:
                # Additional validation - check if line contains printable characters
                if all(ord(c) < 128 and (c.isprintable() or c.isspace()) for c in line):
                    valid_lines.append(line)
        
        return valid_lines
        
    except FileNotFoundError:
        print(f"File {filename} not found.")
        return []
    except Exception as e:
        print(f"Error reading file: {e}")
        return []

def is_valid_gngga_line(line):
    """Additional validation for GNGGA lines"""
    if not line.startswith('$GNGGA'):
        return False
    
    parts = line.split(',')
    if len(parts) < 15:  # GNGGA should have at least 15 fields
        return False
    
    # Check if critical fields are not empty
    lat_raw = parts[2]
    lat_dir = parts[3]
    lon_raw = parts[4]
    lon_dir = parts[5]
    alt_str = parts[9]
    
    # Skip lines with empty critical fields
    if not lat_raw or not lat_dir or not lon_raw or not lon_dir or not alt_str:
        return False
    
    # Check if coordinates are reasonable (not all zeros or clearly invalid)
    try:
        lat_val = float(lat_raw)
        lon_val = float(lon_raw)
        alt_val = float(alt_str)
        
        # Basic sanity checks
        if lat_val == 0 or lon_val == 0:  # Likely invalid
            return False
        if not (0 <= lat_val <= 9000):  # Latitude in DDMM.MMMM format should be 0-9000
            return False
        if not (0 <= lon_val <= 18000):  # Longitude in DDDMM.MMMM format should be 0-18000
            return False
        if not (-1000 <= alt_val <= 10000):  # Altitude should be reasonable
            return False
            
    except ValueError:
        return False
    
    return True

def get_last_valid_position(filename):
    """Get the last valid GNSS position from file"""
    lines = read_latest_gnss_data(filename)
    if not lines:
        return None
    
    # Try to parse from the end of file backwards
    for line in reversed(lines):
        if is_valid_gngga_line(line):
            parsed = parse_gngga(line)
            if parsed:
                return parsed
    return None

# ==== Load and Parse GNSS Data ====
filename = "test.ubx"
print(f"Loading and cleaning GNSS data from {filename}...")

lines = read_latest_gnss_data(filename)
print(f"Found {len(lines)} potentially valid GNGGA lines after initial filtering")

positions = []
skipped_count = 0

for line in lines:
    parsed = parse_gngga(line)
    if parsed:
        positions.append(parsed)
    else:
        skipped_count += 1

print(f"Successfully parsed {len(positions)} valid positions")
print(f"Skipped {skipped_count} invalid/corrupted lines")

if not positions:
    print("No valid GNGGA data found after cleaning.")
    exit()

# ==== Transform Coordinates Relative to Observer ====
coords = []
altitudes = []
for _, lat, lon, alt in positions:
    x, y = geo_to_xy(OBSERVER_LAT, OBSERVER_LON, lat, lon)
    z = alt - OBSERVER_ALT
    coords.append((x, y, z))
    altitudes.append(z)

# Calculate altitude statistics for better staging
min_alt = min(altitudes)
max_alt = max(altitudes)
alt_range = max_alt - min_alt
alt_center = (min_alt + max_alt) / 2

print(f"Altitude Statistics:")
print(f"Min altitude offset: {min_alt:.3f} m")
print(f"Max altitude offset: {max_alt:.3f} m")
print(f"Altitude range: {alt_range:.3f} m")
print(f"Altitude center: {alt_center:.3f} m")

# ==== Visualization ====
fig = plt.figure(figsize=(12, 10))
ax = fig.add_subplot(111, projection='3d')

# Enable interactive mode
plt.ion()

# Draw motion capture stage (circle platform)
theta = np.linspace(0, 2 * np.pi, 100)
circle_x = STAGE_RADIUS * np.cos(theta)
circle_y = STAGE_RADIUS * np.sin(theta)
circle_z = np.zeros_like(circle_x)

# Enhanced 3D Playback with path drawing and ball
ball_radius = 1.0  # Radius of the ball

# Calculate reasonable Z-axis limits based on actual data
z_buffer = max(2.0, alt_range * 2)  # At least 2m buffer or 2x the range
z_min = alt_center - z_buffer
z_max = alt_center + z_buffer

# Storage for path history
path_x = []
path_y = []
path_z = []

print("\nStarting playback... You can rotate the view by dragging with mouse!")
print("Press Ctrl+C to stop playback")

try:
    for i, (x, y, z) in enumerate(coords):
        ax.cla()
        
        # Add current position to path
        path_x.append(x)
        path_y.append(y)
        path_z.append(z)
        
        # Set axis limits
        ax.set_xlim([-STAGE_RADIUS - 2, STAGE_RADIUS + 2])
        ax.set_ylim([-STAGE_RADIUS - 2, STAGE_RADIUS + 2])
        ax.set_zlim([z_min, z_max])
        
        # Enhanced titles and labels
        ax.set_title(f"GNSS Motion Capture Playback\nStep {i+1}/{len(coords)} | Time: {positions[i][0][:6]}", 
                    fontsize=12, fontweight='bold')
        
        # Enhanced axis labels with units and descriptions
        ax.set_xlabel("East Displacement (m)\nfrom Observer Position", fontsize=10, fontweight='bold')
        ax.set_ylabel("North Displacement (m)\nfrom Observer Position", fontsize=10, fontweight='bold')
        ax.set_zlabel("Altitude Offset (m)\nfrom Observer Level", fontsize=10, fontweight='bold')

        # Draw stage platform
        ax.plot(circle_x, circle_y, circle_z, color='gray', linestyle='dotted', linewidth=2, alpha=0.7)
        
        # Draw stage boundary (vertical cylinder)
        for angle in np.linspace(0, 2*np.pi, 8):
            stage_x = STAGE_RADIUS * np.cos(angle)
            stage_y = STAGE_RADIUS * np.sin(angle)
            ax.plot([stage_x, stage_x], [stage_y, stage_y], [z_min, z_max], 
                    color='lightgray', linestyle=':', alpha=0.3)

        # Enhanced origin crosshair with labels
        ax.plot([0, 0], [0, 0], [z_min, z_max], 'k--', linewidth=1, alpha=0.5)
        ax.plot([0, 0], [-STAGE_RADIUS, STAGE_RADIUS], [0, 0], 'k--', linewidth=1, alpha=0.5)
        ax.plot([-STAGE_RADIUS, STAGE_RADIUS], [0, 0], [0, 0], 'k--', linewidth=1, alpha=0.5)
        
        # Add origin label
        ax.text(0, 0, 0, 'Observer\nPosition', fontsize=8, ha='center')

        # Draw path traveled so far
        if len(path_x) > 1:
            ax.plot(path_x, path_y, path_z, color='blue', linewidth=2, alpha=0.8, label='Path')
            # Add path markers at intervals
            if len(path_x) > 5:
                marker_interval = max(1, len(path_x) // 10)
                ax.scatter(path_x[::marker_interval], path_y[::marker_interval], path_z[::marker_interval], 
                          color='lightblue', s=20, alpha=0.6)

        # Draw 3D ball at current GNSS position
        u = np.linspace(0, 2 * np.pi, 20)
        v = np.linspace(0, np.pi, 20)
        ball_x = ball_radius * np.outer(np.cos(u), np.sin(v)) + x
        ball_y = ball_radius * np.outer(np.sin(u), np.sin(v)) + y
        ball_z = ball_radius * np.outer(np.ones(np.size(u)), np.cos(v)) + z
        ax.plot_surface(ball_x, ball_y, ball_z, color='red', alpha=0.8, shade=True)

        # Add position information as text
        position_text = f"Position: E={x:.2f}m, N={y:.2f}m, Alt={z:.3f}m"
        ax.text2D(0.02, 0.98, position_text, transform=ax.transAxes, 
                  fontsize=10, verticalalignment='top', 
                  bbox=dict(boxstyle="round,pad=0.3", facecolor="yellow", alpha=0.7))
        
        # Add distance from observer
        distance_2d = np.sqrt(x**2 + y**2)
        distance_3d = np.sqrt(x**2 + y**2 + z**2)
        distance_text = f"Distance: 2D={distance_2d:.2f}m, 3D={distance_3d:.2f}m"
        ax.text2D(0.02, 0.92, distance_text, transform=ax.transAxes, 
                  fontsize=10, verticalalignment='top',
                  bbox=dict(boxstyle="round,pad=0.3", facecolor="lightblue", alpha=0.7))

        # Add path statistics
        if len(path_x) > 1:
            total_distance = sum(np.sqrt((path_x[j]-path_x[j-1])**2 + (path_y[j]-path_y[j-1])**2 + (path_z[j]-path_z[j-1])**2) 
                               for j in range(1, len(path_x)))
            path_text = f"Path length: {total_distance:.2f}m"
            ax.text2D(0.02, 0.86, path_text, transform=ax.transAxes, 
                      fontsize=10, verticalalignment='top',
                      bbox=dict(boxstyle="round,pad=0.3", facecolor="lightgreen", alpha=0.7))

        # Add grid for better depth perception
        ax.grid(True, alpha=0.3)
        
        # Update display
        plt.draw()
        plt.pause(0.2)

except KeyboardInterrupt:
    print("\nPlayback stopped by user")

plt.ioff()
plt.show()

# Print final summary
print(f"\nPlayback Summary:")
print(f"Total positions: {len(coords)}")
print(f"Horizontal travel range: {max([np.sqrt(x**2 + y**2) for x, y, z in coords]):.2f} m")
print(f"Observer coordinates: {OBSERVER_LAT:.6f}°N, {OBSERVER_LON:.6f}°W, {OBSERVER_ALT:.1f}m ASL")

# ==== Live Mode Function ====
def live_gnss_playback(filename, update_interval=0.01):
    """
    Live GNSS playback that reads from a constantly updating file
    """
    print(f"\nStarting live mode - monitoring {filename}")
    print("Press Ctrl+C to stop live playback")
    
    fig = plt.figure(figsize=(12, 10))
    ax = fig.add_subplot(111, projection='3d')
    plt.ion()
    
    # Storage for live path
    live_path_x = []
    live_path_y = []
    live_path_z = []
    last_file_size = 0
    
    try:
        while True:
                    # Check if file has been updated
                    try:
                        current_file_size = os.path.getsize(filename)
                        if current_file_size != last_file_size:
                            last_file_size = current_file_size
                            
                            # Get latest position with enhanced error handling
                            latest_pos = get_last_valid_position(filename)
                            if latest_pos:
                                _, lat, lon, alt = latest_pos
                                x, y = geo_to_xy(OBSERVER_LAT, OBSERVER_LON, lat, lon)
                                z = alt - OBSERVER_ALT
                                
                                # Validate the position is reasonable
                                if abs(x) > 1000 or abs(y) > 1000 or abs(z) > 100:
                                    print(f"Skipping unreasonable position: x={x:.2f}, y={y:.2f}, z={z:.2f}")
                                    continue
                                
                                # Add to live path
                                live_path_x.append(x)
                                live_path_y.append(y)
                                live_path_z.append(z)
                                
                                # Limit path history to last 1000 points
                                if len(live_path_x) > 1000:
                                    live_path_x = live_path_x[-1000:]
                                    live_path_y = live_path_y[-1000:]
                                    live_path_z = live_path_z[-1000:]
                                
                                # Update visualization
                                ax.cla()
                                
                                # Calculate dynamic Z limits based on recent data
                                if len(live_path_z) > 0:
                                    z_recent_min = min(live_path_z)
                                    z_recent_max = max(live_path_z)
                                    z_recent_range = z_recent_max - z_recent_min
                                    z_recent_center = (z_recent_min + z_recent_max) / 2
                                    z_buffer = max(2.0, z_recent_range * 2)
                                    z_min = z_recent_center - z_buffer
                                    z_max = z_recent_center + z_buffer
                                else:
                                    z_min, z_max = -5, 5
                                
                                # Set axis limits
                                ax.set_xlim([-STAGE_RADIUS - 2, STAGE_RADIUS + 2])
                                ax.set_ylim([-STAGE_RADIUS - 2, STAGE_RADIUS + 2])
                                ax.set_zlim([z_min, z_max])
                                
                                # Labels and title
                                ax.set_title(f"Live GNSS Tracking | Time: {latest_pos[0][:6]} | Points: {len(live_path_x)}", 
                                            fontsize=12, fontweight='bold')
                                ax.set_xlabel("East Displacement (m)", fontsize=10, fontweight='bold')
                                ax.set_ylabel("North Displacement (m)", fontsize=10, fontweight='bold')
                                ax.set_zlabel("Altitude Offset (m)", fontsize=10, fontweight='bold')
                                
                                # Draw stage
                                theta = np.linspace(0, 2 * np.pi, 100)
                                circle_x = STAGE_RADIUS * np.cos(theta)
                                circle_y = STAGE_RADIUS * np.sin(theta)
                                circle_z = np.zeros_like(circle_x)
                                ax.plot(circle_x, circle_y, circle_z, color='gray', linestyle='dotted', linewidth=2, alpha=0.7)
                                
                                # Draw path
                                if len(live_path_x) > 1:
                                    ax.plot(live_path_x, live_path_y, live_path_z, color='blue', linewidth=2, alpha=0.8)
                                
                                # Draw current position ball
                                if len(live_path_x) > 0:
                                    u = np.linspace(0, 2 * np.pi, 10)
                                    v = np.linspace(0, np.pi, 10)
                                    ball_x = ball_radius * np.outer(np.cos(u), np.sin(v)) + x
                                    ball_y = ball_radius * np.outer(np.sin(u), np.sin(v)) + y
                                    ball_z = ball_radius * np.outer(np.ones(np.size(u)), np.cos(v)) + z
                                    ax.plot_surface(ball_x, ball_y, ball_z, color='red', alpha=0.8)
                                
                                # Add position info
                                position_text = f"Pos: E={x:.2f}m, N={y:.2f}m, Alt={z:.3f}m"
                                ax.text2D(0.02, 0.98, position_text, transform=ax.transAxes, 
                                          fontsize=10, verticalalignment='top', 
                                          bbox=dict(boxstyle="round,pad=0.3", facecolor="yellow", alpha=0.7))
                                
                                ax.grid(True, alpha=0.3)
                                plt.draw()
                            else:
                                print("No valid position found in recent data")
                                
                    except FileNotFoundError:
                        print(f"Waiting for file {filename}...")
                    except Exception as e:
                        print(f"Error in live mode: {e}")
                        # Continue running even if there's an error
                
        time.sleep(update_interval)
                
    except KeyboardInterrupt:
        print("\nLive playback stopped by user")
    
    plt.ioff()
    plt.show()

# Uncomment the line below to run in live mode instead of playback mode
# live_gnss_playback("jirun1.ubx", update_interval=0.5)