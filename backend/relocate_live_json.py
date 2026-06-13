import json
from pathlib import Path

# Correct path relative to project root
LIVE_FILE = Path("backend/data/live.json")
NEW_LAT = 49.534767
NEW_LON = 8.461813
OLD_LAT = 49.452
OLD_LON = 8.518

LAT_OFFSET = NEW_LAT - OLD_LAT
LON_OFFSET = NEW_LON - OLD_LON

def relocate():
    # If it's in the wrong place, move it first
    wrong_file = Path("backend/live.json")
    if wrong_file.exists() and not LIVE_FILE.exists():
        LIVE_FILE.parent.mkdir(parents=True, exist_ok=True)
        wrong_file.rename(LIVE_FILE)
        print(f"Moved {wrong_file} to {LIVE_FILE}")

    if not LIVE_FILE.exists():
        print(f"{LIVE_FILE} not found")
        return

    with open(LIVE_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Reset coordinates to original before applying the new offset 
    # (in case the script was run multiple times on the same file)
    # Actually, easier to just check if the incident is already at the target
    current_coords = data.get("incident", {}).get("location", {}).get("coords", [0, 0])
    if current_coords == [NEW_LAT, NEW_LON]:
        print("Already relocated.")
        return

    # 1. Update incident metadata
    incident = data.get("incident", {})
    if "location" in incident:
        incident["location"]["coords"] = [NEW_LAT, NEW_LON]
        incident["location"]["district"] = "Waldhof"
    
    # 2. Update all posts
    for post in data.get("posts", []):
        # Update text
        post["text"] = post["text"].replace("Rheinau", "Waldhof")
        
        # Update coordinates
        loc = post.get("location", {})
        coords = loc.get("coords")
        if coords and isinstance(coords, list) and len(coords) == 2:
            # Shift relative to the CURRENT coords if they aren't OLD_LAT
            # But live.json usually comes with the old ones.
            # To be safe, we'll assume the file was either OLD or partially shifted.
            # If we detect NEW_LAT, we stop.
            coords[0] += LAT_OFFSET
            coords[1] += LON_OFFSET
            loc["coords"] = coords

    with open(LIVE_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    
    print(f"Relocated {len(data.get('posts', []))} posts to Waldhof center ({NEW_LAT}, {NEW_LON}).")

if __name__ == "__main__":
    relocate()

if __name__ == "__main__":
    relocate()
