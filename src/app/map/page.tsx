"use client";

import { useEffect, useState, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-routing-machine";
import SunCalc from "suncalc";

type Coordinate = { lat: number; lng: number };

export default function MapWithSunRoute() {
  const [map, setMap] = useState<L.Map | null>(null);
  const [startText, setStartText] = useState("");
  const [endText, setEndText] = useState("");
  const [startSuggestions, setStartSuggestions] = useState<any[]>([]);
  const [endSuggestions, setEndSuggestions] = useState<any[]>([]);
  const [startCoords, setStartCoords] = useState<Coordinate | null>(null);
  const [endCoords, setEndCoords] = useState<Coordinate | null>(null);
  const [customTime, setCustomTime] = useState<string>("");
  const [useCurrentTime, setUseCurrentTime] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>("");

  const panelRef = useRef<HTMLDivElement>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const routingControlRef = useRef<any>(null);

  useEffect(() => {
    // Fix default marker icons
    delete (L.Icon.Default.prototype as any)._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    });

    const mapInstance = L.map("map").setView([51.505, -0.09], 13);
    setMap(mapInstance);

    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      { attribution: '&copy; <a href="https://www.carto.com/">CARTO</a>', subdomains: "abcd", maxZoom: 19 }
    ).addTo(mapInstance);

    return () => {
      if (mapInstance) {
        mapInstance.remove();
      }
    };
  }, []);

  const searchLocation = async (query: string) => {
    if (!query.trim()) return [];
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=1`
      );
      if (!res.ok) throw new Error('Search failed');
      const data = await res.json();
      return data;
    } catch (err) {
      console.error("Search error:", err);
      return [];
    }
  };

  const handleStartChange = async (val: string) => {
    setStartText(val);
    if (val.length > 2) {
      const results = await searchLocation(val);
      setStartSuggestions(results);
    } else {
      setStartSuggestions([]);
    }
  };

  const handleEndChange = async (val: string) => {
    setEndText(val);
    if (val.length > 2) {
      const results = await searchLocation(val);
      setEndSuggestions(results);
    } else {
      setEndSuggestions([]);
    }
  };

  const selectStart = (loc: any) => {
    setStartText(loc.display_name);
    setStartCoords({ lat: parseFloat(loc.lat), lng: parseFloat(loc.lon) });
    setStartSuggestions([]);
  };

  const selectEnd = (loc: any) => {
    setEndText(loc.display_name);
    setEndCoords({ lat: parseFloat(loc.lat), lng: parseFloat(loc.lon) });
    setEndSuggestions([]);
  };

  const getBearing = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const toDeg = (rad: number) => (rad * 180) / Math.PI;
    const dLon = toRad(lon2 - lon1);
    const y = Math.sin(dLon) * Math.cos(toRad(lat2));
    const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
              Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  };

  const timePerSegment = (lat1: number, lon1: number, lat2: number, lon2: number, speed = 15) => {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    return (distance / speed) * 3600 * 1000;
  };

  const getSunAzimuth = (lat: number, lon: number, date: Date = new Date()) => {
    const sunPos = SunCalc.getPosition(date, lat, lon);
    return { azimuth: ((sunPos.azimuth * 180) / Math.PI + 180) % 360, altitude: (sunPos.altitude * 180) / Math.PI };
  };

  const drawRouteSun = async () => {
    if (!map) return;

    setIsLoading(true);
    setError("");

    try {
      // Clear previous routing control
      if (routingControlRef.current) {
        map.removeControl(routingControlRef.current);
        routingControlRef.current = null;
      }

      // Clear previous layers
      map.eachLayer(layer => {
        if ((layer as any).options?.weight === 5) {
          map.removeLayer(layer);
        }
      });

      // Get coordinates
      let start = startCoords;
      let end = endCoords;

      if (!start && startText) {
        const startResults = await searchLocation(startText);
        if (startResults.length > 0) {
          start = { lat: parseFloat(startResults[0].lat), lng: parseFloat(startResults[0].lon) };
          setStartCoords(start);
        }
      }

      if (!end && endText) {
        const endResults = await searchLocation(endText);
        if (endResults.length > 0) {
          end = { lat: parseFloat(endResults[0].lat), lng: parseFloat(endResults[0].lon) };
          setEndCoords(end);
        }
      }

      if (!start || !end) {
        setError("Please select both start and end locations");
        return;
      }

      const startLatLng = L.latLng(start.lat, start.lng);
      const endLatLng = L.latLng(end.lat, end.lng);

      const control = (L as any).Routing.control({
        waypoints: [startLatLng, endLatLng],
        addWaypoints: false,
        draggableWaypoints: false,
        show: false,
        fitSelectedRoutes: true,
        routeWhileDragging: false,
        lineOptions: {
          styles: [{ opacity: 0, weight: 0 }] // Hide the default route line
        },
        createMarker: (i: number, wp: any) => {
          if (i === 0 || i === 1) {
            return L.marker(wp.latLng, {
              icon: L.icon({
                iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
                iconSize: [25, 41],
                iconAnchor: [12, 41],
                popupAnchor: [1, -34],
              }),
            }).bindPopup(i === 0 ? "Start" : "End");
          }
          return null;
        },
      });

      routingControlRef.current = control;
      control.addTo(map);

      // Hide the routing instructions container
      setTimeout(() => {
        const routingContainer = document.querySelector('.leaflet-routing-container');
        if (routingContainer) {
          (routingContainer as HTMLElement).style.display = 'none';
        }
      }, 100);

      control.on("routesfound", (e: any) => {
        const coords: Coordinate[] = e.routes[0].coordinates.map((c: any) => ({
          lat: c.lat,
          lng: c.lng,
        }));

        const startTime = useCurrentTime ? new Date() : new Date(customTime || Date.now());
        let cumulativeTime = 0;
        let leftSunTime = 0;
        let rightSunTime = 0;

        coords.forEach((curr, i) => {
          if (i === coords.length - 1) return;
          const next = coords[i + 1];

          const segmentTime = timePerSegment(curr.lat, curr.lng, next.lat, next.lng);
          cumulativeTime += segmentTime;
          const dateAtSegment = new Date(startTime.getTime() + cumulativeTime);

          const heading = getBearing(curr.lat, curr.lng, next.lat, next.lng);
          const sun = getSunAzimuth(curr.lat, curr.lng, dateAtSegment);
          const relAngle = (sun.azimuth - heading + 360) % 360;

          if (sun.altitude > 0) {
            if (relAngle < 180) {
              rightSunTime += segmentTime;
            } else {
              leftSunTime += segmentTime;
            }
          }

          let color = "#4444aa"; // blue for night
          if (sun.altitude > 0) {
            color = relAngle < 180 ? "#22aa22" : "#aa2222"; // green for right, red for left
          }

          L.polyline([[curr.lat, curr.lng], [next.lat, next.lng]], {
            color,
            weight: 5,
          }).addTo(map);
        });

        const totalTime = leftSunTime + rightSunTime;
        const leftPercent = totalTime ? Math.round((leftSunTime / totalTime) * 100) : 0;
        const rightPercent = totalTime ? Math.round((rightSunTime / totalTime) * 100) : 0;

        const percentDiv = document.getElementById("sunPercent");
        if (percentDiv) {
          percentDiv.innerHTML = `Left: ${leftPercent}% ☀️ | Right: ${rightPercent}% ☀️`;
        }
      });

      control.on("routingerror", (e: any) => {
        setError("Failed to calculate route. Please try different locations.");
        console.error("Routing error:", e);
      });

    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to draw route");
      console.error("Route drawing error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  // Draggable panel
  const onMouseDown = (e: React.MouseEvent) => {
    // Don't start dragging if clicking on input elements or buttons
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'BUTTON' || target.tagName === 'LABEL' || target.closest('input, button, label')) {
      return;
    }
    
    isDragging.current = true;
    const rect = panelRef.current!.getBoundingClientRect();
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    e.preventDefault();
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!isDragging.current || !panelRef.current) return;
    const newX = Math.max(0, Math.min(window.innerWidth - panelRef.current.offsetWidth, e.clientX - dragOffset.current.x));
    const newY = Math.max(0, Math.min(window.innerHeight - panelRef.current.offsetHeight, e.clientY - dragOffset.current.y));
    panelRef.current.style.left = `${newX}px`;
    panelRef.current.style.top = `${newY}px`;
  };

  const onMouseUp = () => {
    isDragging.current = false;
  };

  useEffect(() => {
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  return (
    <div className="relative w-full h-screen">
      {/* Map container */}
      <div id="map" className="absolute top-0 left-0 w-full h-full z-0"></div>

      {/* Error display */}
      {error && (
        <div className="absolute top-20 left-1/2 transform -translate-x-1/2 z-50 bg-red-600 text-white p-3 rounded shadow-lg max-w-md text-center">
          {error}
          <button 
            onClick={() => setError("")}
            className="ml-2 text-red-200 hover:text-white"
          >
            ×
          </button>
        </div>
      )}

      {/* Floating panel */}
      <div
        ref={panelRef}
        className="absolute top-4 left-4 z-50 bg-black bg-opacity-90 p-4 rounded-lg shadow-xl border border-gray-600 pointer-events-auto"
      >
        <div className="flex items-center mb-2 cursor-move" onMouseDown={onMouseDown}>
          <div className="text-white text-sm font-medium">☰ Drag to move</div>
        </div>
        <div className="flex flex-wrap gap-3 items-center pointer-events-auto">
          {/* start input */}
          <div className="relative">
            <input
              type="text"
              placeholder="Start location"
              value={startText}
              onChange={e => handleStartChange(e.target.value)}
              className="border border-gray-600 p-2 w-64 bg-gray-800 text-white rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
            {startSuggestions.length > 0 && (
              <ul className="absolute top-full left-0 bg-gray-800 text-white border border-gray-600 w-64 max-h-48 overflow-y-auto z-50 rounded shadow-lg">
                {startSuggestions.map((s, idx) => (
                  <li
                    key={idx}
                    className="p-2 hover:bg-gray-700 cursor-pointer border-b border-gray-700 last:border-b-0 text-sm"
                    onClick={() => selectStart(s)}
                  >
                    {s.display_name}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* end input */}
          <div className="relative">
            <input
              type="text"
              placeholder="End location"
              value={endText}
              onChange={e => handleEndChange(e.target.value)}
              className="border border-gray-600 p-2 w-64 bg-gray-800 text-white rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
            {endSuggestions.length > 0 && (
              <ul className="absolute top-full left-0 bg-gray-800 text-white border border-gray-600 w-64 max-h-48 overflow-y-auto z-50 rounded shadow-lg">
                {endSuggestions.map((s, idx) => (
                  <li
                    key={idx}
                    className="p-2 hover:bg-gray-700 cursor-pointer border-b border-gray-700 last:border-b-0 text-sm"
                    onClick={() => selectEnd(s)}
                  >
                    {s.display_name}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <input
            type="datetime-local"
            value={customTime}
            onChange={e => setCustomTime(e.target.value)}
            disabled={useCurrentTime}
            className="border border-gray-600 p-2 bg-gray-800 text-white rounded focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:opacity-50"
          />

          <label className="text-white flex items-center gap-2">
            <input
              type="checkbox"
              checked={useCurrentTime}
              onChange={e => setUseCurrentTime(e.target.checked)}
              className="rounded"
            />
            Current time
          </label>

          <button
            onClick={drawRouteSun}
            disabled={isLoading}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded transition-colors"
          >
            {isLoading ? "Loading..." : "Draw Route"}
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="absolute top-4 right-4 z-50 bg-black bg-opacity-90 p-4 rounded-lg shadow-xl border border-gray-600">
        <h3 className="text-white font-bold mb-2 text-sm">Legend</h3>
        <div className="text-xs text-white space-y-1">
          <div className="flex items-center gap-2">
            <div className="w-4 h-2 bg-green-500 rounded"></div>
            <span>Sun on right</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-2 bg-red-500 rounded"></div>
            <span>Sun on left</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-2 bg-blue-500 rounded"></div>
            <span>Nighttime</span>
          </div>
        </div>
      </div>

      {/* Sunlight percentage display */}
      <div
        id="sunPercent"
        className="absolute bottom-4 left-4 z-50 bg-black bg-opacity-90 p-3 text-white rounded-lg shadow-xl border border-gray-600"
      >
        Left: 0% ☀️ | Right: 0% ☀️
      </div>
    </div>
  );
}