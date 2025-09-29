"use client"
import { useEffect, useState, useRef } from "react"
import type React from "react"

// SunCalc calculations inline to avoid import issues
const getSunPosition = (date: Date, lat: number, lng: number) => {
  const toRad = Math.PI / 180
  const toDeg = 180 / Math.PI

  const dayMs = 1000 * 60 * 60 * 24
  const J1970 = 2440588
  const J2000 = 2451545

  const toJulian = (date: Date) => date.getTime() / dayMs - 0.5 + J1970
  const toDays = (date: Date) => toJulian(date) - J2000

  const rightAscension = (l: number, b: number) =>
    Math.atan2(Math.sin(l) * Math.cos(0.409093) - Math.tan(b) * Math.sin(0.409093), Math.cos(l))
  const declination = (l: number, b: number) =>
    Math.asin(Math.sin(b) * Math.cos(0.409093) + Math.cos(b) * Math.sin(0.409093) * Math.sin(l))
  const azimuth = (H: number, phi: number, dec: number) =>
    Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi))
  const altitude = (H: number, phi: number, dec: number) =>
    Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H))
  const siderealTime = (d: number, lw: number) => 4.894961 + 6.300388099 * d + lw

  const solarMeanAnomaly = (d: number) => 6.240040768 + 0.0172019699 * d
  const eclipticLongitude = (M: number) => 1.796593063 + M + 0.034906585 * Math.sin(M)

  const d = toDays(date)
  const L = eclipticLongitude(solarMeanAnomaly(d))
  const dec = declination(L, 0)
  const ra = rightAscension(L, 0)
  const lw = -lng * toRad
  const phi = lat * toRad
  const H = siderealTime(d, lw) - ra

  return {
    azimuth: azimuth(H, phi, dec),
    altitude: altitude(H, phi, dec),
  }
}

type Coordinate = { lat: number; lng: number }

interface LocationResult {
  lat: string
  lon: string
  display_name: string
}

export default function MapWithSunRoute() {
  const [map, setMap] = useState<any>(null)
  const [L, setL] = useState<any>(null)
  const [startText, setStartText] = useState("")
  const [endText, setEndText] = useState("")
  const [startSuggestions, setStartSuggestions] = useState<LocationResult[]>([])
  const [endSuggestions, setEndSuggestions] = useState<LocationResult[]>([])
  const [startCoords, setStartCoords] = useState<Coordinate | null>(null)
  const [endCoords, setEndCoords] = useState<Coordinate | null>(null)
  const [customTime, setCustomTime] = useState<string>("")
  const [useCurrentTime, setUseCurrentTime] = useState(true)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string>("")
  const [routeCalculated, setRouteCalculated] = useState(false)

  const panelRef = useRef<HTMLDivElement>(null)
  const dragOffset = useRef({ x: 0, y: 0 })
  const isDragging = useRef(false)
  const routingControlRef = useRef<any>(null)
  const debounceTimeouts = useRef<{ start?: NodeJS.Timeout; end?: NodeJS.Timeout }>({})

  // Load routing machine dynamically
  const loadRoutingMachine = (): Promise<void> => {
    return new Promise((resolve, reject) => {
      if ((window as any).L && (window as any).L.Routing) {
        resolve()
        return
      }

      const script = document.createElement("script")
      script.src = "https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.js"
      script.async = true

      script.onload = () => {
        setTimeout(() => {
          if ((window as any).L && (window as any).L.Routing) {
            resolve()
          } else {
            reject(new Error("Routing machine failed to initialize"))
          }
        }, 100)
      }

      script.onerror = () => {
        reject(new Error("Failed to load routing machine"))
      }

      document.head.appendChild(script)
    })
  }

  // Load Leaflet dynamically on client only
  useEffect(() => {
    const loadLeaflet = async () => {
      try {
        const link = document.createElement("link")
        link.rel = "stylesheet"
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
        document.head.appendChild(link)

        const leaflet = await import("leaflet")

        delete (leaflet.Icon.Default.prototype as any)._getIconUrl
        leaflet.Icon.Default.mergeOptions({
          iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
          iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
          shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
        })

        const mapInstance = leaflet.map("map").setView([51.505, -0.09], 13)

        leaflet
          .tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
            attribution: '&copy; <a href="https://www.carto.com/">CARTO</a>',
            subdomains: "abcd",
            maxZoom: 19,
          })
          .addTo(mapInstance)

        await loadRoutingMachine()

        setL(leaflet)
        setMap(mapInstance)
      } catch (err) {
        setError("Failed to load map. Please refresh the page.")
        console.error("Map loading error:", err)
      }
    }

    loadLeaflet()

    return () => {
      if (map) {
        map.remove()
      }
    }
  }, [])

  const searchLocation = async (query: string): Promise<LocationResult[]> => {
    if (!query.trim()) return []

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000)

      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
          query,
        )}&format=json&limit=5&addressdetails=1`,
        {
          signal: controller.signal,
          headers: {
            "User-Agent": "SunRouteApp/1.0",
          },
        },
      )

      clearTimeout(timeoutId)

      if (!res.ok) throw new Error(`Search failed: ${res.status}`)

      const data = await res.json()
      return data.filter((item: any) => item.lat && item.lon) || []
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        console.log("Search request timed out")
      } else {
        console.error("Search error:", err)
      }
      return []
    }
  }

  const handleStartChange = async (val: string) => {
    setStartText(val)

    if (debounceTimeouts.current.start) {
      clearTimeout(debounceTimeouts.current.start)
    }

    if (val.length > 2) {
      debounceTimeouts.current.start = setTimeout(async () => {
        const results = await searchLocation(val)
        setStartSuggestions(results)
      }, 300)
    } else {
      setStartSuggestions([])
    }
  }

  const handleEndChange = async (val: string) => {
    setEndText(val)

    if (debounceTimeouts.current.end) {
      clearTimeout(debounceTimeouts.current.end)
    }

    if (val.length > 2) {
      debounceTimeouts.current.end = setTimeout(async () => {
        const results = await searchLocation(val)
        setEndSuggestions(results)
      }, 300)
    } else {
      setEndSuggestions([])
    }
  }

  const selectStart = (loc: LocationResult) => {
    setStartText(loc.display_name)
    setStartCoords({ lat: Number.parseFloat(loc.lat), lng: Number.parseFloat(loc.lon) })
    setStartSuggestions([])
  }

  const selectEnd = (loc: LocationResult) => {
    setEndText(loc.display_name)
    setEndCoords({ lat: Number.parseFloat(loc.lat), lng: Number.parseFloat(loc.lon) })
    setEndSuggestions([])
  }

  const getBearing = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const toRad = (deg: number) => (deg * Math.PI) / 180
    const toDeg = (rad: number) => (rad * 180) / Math.PI

    const dLon = toRad(lon2 - lon1)
    const lat1Rad = toRad(lat1)
    const lat2Rad = toRad(lat2)

    const y = Math.sin(dLon) * Math.cos(lat2Rad)
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon)

    const bearing = toDeg(Math.atan2(y, x))
    return (bearing + 360) % 360
  }

  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371
    const dLat = ((lat2 - lat1) * Math.PI) / 180
    const dLon = ((lon2 - lon1) * Math.PI) / 180

    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
  }

  const timePerSegment = (lat1: number, lon1: number, lat2: number, lon2: number, speed = 50): number => {
    const distance = calculateDistance(lat1, lon1, lat2, lon2)
    return (distance / speed) * 3600 * 1000
  }

  const getSunAzimuth = (lat: number, lon: number, date: Date = new Date()) => {
    const sunPos = getSunPosition(date, lat, lon)
    return {
      azimuth: ((sunPos.azimuth * 180) / Math.PI + 180) % 360,
      altitude: (sunPos.altitude * 180) / Math.PI,
    }
  }

  const drawRouteSun = async () => {
    if (!map || !L) return

    setIsLoading(true)
    setError("")

    try {
      if (routingControlRef.current) {
        map.removeControl(routingControlRef.current)
        routingControlRef.current = null
      }

      map.eachLayer((layer: any) => {
        if (layer.options?.weight === 5) {
          map.removeLayer(layer)
        }
      })

      let start = startCoords
      let end = endCoords

      if (!start && startText.trim()) {
        const startResults = await searchLocation(startText)
        if (startResults.length > 0) {
          start = {
            lat: Number.parseFloat(startResults[0].lat),
            lng: Number.parseFloat(startResults[0].lon),
          }
          setStartCoords(start)
        }
      }

      if (!end && endText.trim()) {
        const endResults = await searchLocation(endText)
        if (endResults.length > 0) {
          end = {
            lat: Number.parseFloat(endResults[0].lat),
            lng: Number.parseFloat(endResults[0].lon),
          }
          setEndCoords(end)
        }
      }

      if (!start || !end) {
        setError("Please select both start and end locations")
        return
      }

      if (isNaN(start.lat) || isNaN(start.lng) || isNaN(end.lat) || isNaN(end.lng)) {
        setError("Invalid coordinates. Please select valid locations.")
        return
      }

      const startLatLng = L.latLng(start.lat, start.lng)
      const endLatLng = L.latLng(end.lat, end.lng)

      if (!L.Routing && !(window as any).L.Routing) {
        setError("Routing functionality not available. Please refresh the page.")
        return
      }

      const routingL = (window as any).L || L

      const control = routingL.Routing.control({
        waypoints: [startLatLng, endLatLng],
        addWaypoints: false,
        draggableWaypoints: false,
        show: false,
        fitSelectedRoutes: true,
        routeWhileDragging: false,
        lineOptions: {
          styles: [{ opacity: 0, weight: 0 }],
        },
        createMarker: () => null,
      })

      routingControlRef.current = control
      control.addTo(map)

      setTimeout(() => {
        const routingContainer = document.querySelector(".leaflet-routing-container")
        if (routingContainer) {
          ;(routingContainer as HTMLElement).style.display = "none"
        }
      }, 100)

      control.on("routesfound", (e: any) => {
        try {
          if (!e.routes || e.routes.length === 0) {
            setError("No route found between the selected locations")
            return
          }

          const coords: Coordinate[] = e.routes[0].coordinates.map((c: any) => ({
            lat: c.lat,
            lng: c.lng,
          }))

          if (coords.length < 2) {
            setError("Route too short to analyze")
            return
          }

          const startTime = useCurrentTime ? new Date() : new Date(customTime || Date.now())
          let cumulativeTime = 0
          let leftSunTime = 0
          let rightSunTime = 0

          coords.forEach((curr, i) => {
            if (i === coords.length - 1) return

            const next = coords[i + 1]
            const segmentTime = timePerSegment(curr.lat, curr.lng, next.lat, next.lng)
            
            const dateAtSegment = new Date(startTime.getTime() + cumulativeTime)
            
            cumulativeTime += segmentTime

            const heading = getBearing(curr.lat, curr.lng, next.lat, next.lng)
            const sun = getSunAzimuth(curr.lat, curr.lng, dateAtSegment)

            // Sun altitude check: -0.833 degrees accounts for atmospheric refraction
            // This is when the sun's upper edge touches the horizon
            const HORIZON_THRESHOLD = -0.833
            
            let relAngle = sun.azimuth - heading
            
            if (relAngle > 180) relAngle -= 360
            if (relAngle < -180) relAngle += 360

            let color = "#4444aa"

            if (sun.altitude > HORIZON_THRESHOLD) {
              // Sun is above horizon (visible)
              if (relAngle > 0) {
                // Sun on the right side (0 to 180 degrees)
                rightSunTime += segmentTime
                color = "#baffc9"
              } else {
                // Sun on the left side (-180 to 0 degrees)
                leftSunTime += segmentTime
                color = "#ffb3ba"
              }
            }

            L.polyline(
              [
                [curr.lat, curr.lng],
                [next.lat, next.lng],
              ],
              {
                color,
                weight: 5,
                opacity: 0.8,
              },
            ).addTo(map)
          })

          const totalSunTime = leftSunTime + rightSunTime
          const leftPercent = totalSunTime > 0 ? Math.round((leftSunTime / totalSunTime) * 100) : 0
          const rightPercent = totalSunTime > 0 ? Math.round((rightSunTime / totalSunTime) * 100) : 0

          const percentDiv = document.getElementById("sunPercent")
          if (percentDiv) {
            if (totalSunTime === 0) {
              percentDiv.innerHTML = `<span style="color: #9ca3af;">Route entirely in darkness 🌙</span>`
            } else {
              const leftHTML = `<span style="color:#ffb3ba; font-weight:bold;">${leftPercent}%</span>`
              const rightHTML = `<span style="color:#baffc9; font-weight:bold;">${rightPercent}%</span>`

              let suggestion = ""
              if (leftPercent > rightPercent + 5) {
                suggestion = `<span style="color:#baffc9;">💡 Sit on the right side to avoid sun</span>`
              } else if (rightPercent > leftPercent + 5) {
                suggestion = `<span style="color:#ffb3ba;">💡 Sit on the left side to avoid sun</span>`
              } else {
                suggestion = `<span style="color:#9ca3af;">Both sides get similar sun exposure</span>`
              }

              percentDiv.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 8px;">
                  <span>Left: ${leftHTML} ☀️</span>
                  <span style="color: rgba(255, 255, 255, 0.6);">|</span>
                  <span>Right: ${rightHTML} ☀️</span>
                </div>
                <div style="font-size: 0.875rem;">${suggestion}</div>
              `
            }
          }

          const group = L.featureGroup(
            coords.slice(0, -1).map((curr, i) =>
              L.polyline([
                [curr.lat, curr.lng],
                [coords[i + 1].lat, coords[i + 1].lng],
              ]),
            ),
          )
          map.fitBounds(group.getBounds(), { padding: [20, 20] })

          setRouteCalculated(true)
        } catch (routeError) {
          console.error("Route processing error:", routeError)
          setError("Failed to process route data")
        }
      })

      control.on("routingerror", (e: any) => {
        console.error("Routing error:", e)
        setError("Failed to calculate route. Please try different locations or check your internet connection.")
      })
    } catch (err) {
      console.error("Route drawing error:", err)
      setError(err instanceof Error ? err.message : "Failed to draw route")
    } finally {
      setIsLoading(false)
    }
  }

  const resetRoute = () => {
    setRouteCalculated(false)
    setStartText("")
    setEndText("")
    setStartCoords(null)
    setEndCoords(null)
    setStartSuggestions([])
    setEndSuggestions([])
    setError("")

    if (map && routingControlRef.current) {
      map.removeControl(routingControlRef.current)
      routingControlRef.current = null
    }

    if (map) {
      map.eachLayer((layer: any) => {
        if (layer.options?.weight === 5) {
          map.removeLayer(layer)
        }
      })
    }

    const percentDiv = document.getElementById("sunPercent")
    if (percentDiv) {
      percentDiv.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; gap: 8px;">
          <span>Left: 0% ☀️</span>
          <span style="color: rgba(255, 255, 255, 0.6);">|</span>
          <span>Right: 0% ☀️</span>
        </div>
      `
    }
  }

  const onMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (
      target.tagName === "INPUT" ||
      target.tagName === "BUTTON" ||
      target.tagName === "LABEL" ||
      target.closest("input, button, label")
    ) {
      return
    }

    isDragging.current = true
    const rect = panelRef.current!.getBoundingClientRect()
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    e.preventDefault()
  }

  const onTouchStart = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement
    if (
      target.tagName === "INPUT" ||
      target.tagName === "BUTTON" ||
      target.tagName === "LABEL" ||
      target.closest("input, button, label")
    ) {
      return
    }

    isDragging.current = true
    const rect = panelRef.current!.getBoundingClientRect()
    const touch = e.touches[0]
    dragOffset.current = { x: touch.clientX - rect.left, y: touch.clientY - rect.top }
    e.preventDefault()
  }

  const onMouseMove = (e: MouseEvent) => {
    if (!isDragging.current || !panelRef.current) return

    const newX = Math.max(
      0,
      Math.min(window.innerWidth - panelRef.current.offsetWidth, e.clientX - dragOffset.current.x),
    )
    const newY = Math.max(
      0,
      Math.min(window.innerHeight - panelRef.current.offsetHeight, e.clientY - dragOffset.current.y),
    )

    panelRef.current.style.left = `${newX}px`
    panelRef.current.style.top = `${newY}px`
  }

  const onTouchMove = (e: TouchEvent) => {
    if (!isDragging.current || !panelRef.current) return

    const touch = e.touches[0]
    const newX = Math.max(
      0,
      Math.min(window.innerWidth - panelRef.current.offsetWidth, touch.clientX - dragOffset.current.x),
    )
    const newY = Math.max(
      0,
      Math.min(window.innerHeight - panelRef.current.offsetHeight, touch.clientY - dragOffset.current.y),
    )

    panelRef.current.style.left = `${newX}px`
    panelRef.current.style.top = `${newY}px`
    e.preventDefault()
  }

  const onMouseUp = () => {
    isDragging.current = false
  }

  const onTouchEnd = () => {
    isDragging.current = false
  }

  useEffect(() => {
    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)
    window.addEventListener("touchmove", onTouchMove, { passive: false })
    window.addEventListener("touchend", onTouchEnd)

    return () => {
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)
      window.removeEventListener("touchmove", onTouchMove)
      window.removeEventListener("touchend", onTouchEnd)

      Object.values(debounceTimeouts.current).forEach((timeout) => {
        if (timeout) clearTimeout(timeout)
      })
    }
  }, [])

  useEffect(() => {
    if (!customTime) {
      const now = new Date()
      const localDateTime = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
      setCustomTime(localDateTime)
    }
  }, [customTime])

  return (
    <div className="relative w-full h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-900">
      <div id="map" className="absolute top-0 left-0 w-full h-full z-0"></div>

      {error && (
        <div className="absolute top-6 left-1/2 transform -translate-x-1/2 z-50 backdrop-blur-xl bg-red-500/20 border border-red-400/30 text-red-100 p-4 rounded-2xl shadow-2xl max-w-md text-center animate-in slide-in-from-top-2">
          <div className="text-sm font-medium">{error}</div>
          <button
            onClick={() => setError("")}
            className="ml-3 text-red-200 hover:text-white font-bold text-lg leading-none transition-colors"
          >
            ×
          </button>
        </div>
      )}

      <div
        ref={panelRef}
        className="absolute top-6 left-6 z-50 backdrop-blur-xl bg-white/10 border border-white/20 rounded-2xl shadow-2xl pointer-events-auto w-72 max-w-[calc(100vw-3rem)] sm:w-80"
      >
        <div
          className="flex items-center justify-between p-4 pb-3 cursor-move border-b border-white/10"
          onMouseDown={onMouseDown}
          onTouchStart={onTouchStart}
        >
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-amber-400 rounded-full animate-pulse"></div>
            <div className="text-white/90 text-sm font-medium">Avoid Sun Route</div>
          </div>
          <div className="text-white/60 text-xs">☰</div>
        </div>

        <div className="p-4 space-y-3 pointer-events-auto">
          {!routeCalculated ? (
            <>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Start location"
                  value={startText}
                  onChange={(e) => handleStartChange(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl text-white placeholder-white/60 focus:ring-2 focus:ring-blue-400/50 focus:border-blue-400/50 focus:outline-none transition-all duration-200"
                />
                {startSuggestions.length > 0 && (
                  <ul className="absolute top-full left-0 mt-1 bg-gray-900/95 backdrop-blur-xl border border-white/30 w-full max-h-40 overflow-y-auto z-50 rounded-xl shadow-2xl">
                    {startSuggestions.map((s, idx) => (
                      <li
                        key={idx}
                        className="p-3 hover:bg-white/25 cursor-pointer border-b border-white/15 last:border-b-0 text-xs text-white transition-colors duration-150"
                        onClick={() => selectStart(s)}
                      >
                        {s.display_name}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="relative">
                <input
                  type="text"
                  placeholder="End location"
                  value={endText}
                  onChange={(e) => handleEndChange(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl text-white placeholder-white/60 focus:ring-2 focus:ring-blue-400/50 focus:border-blue-400/50 focus:outline-none transition-all duration-200"
                />
                {endSuggestions.length > 0 && (
                  <ul className="absolute top-full left-0 mt-1 bg-gray-900/95 backdrop-blur-xl border border-white/30 w-full max-h-40 overflow-y-auto z-50 rounded-xl shadow-2xl">
                    {endSuggestions.map((s, idx) => (
                      <li
                        key={idx}
                        className="p-3 hover:bg-white/25 cursor-pointer border-b border-white/15 last:border-b-0 text-xs text-white transition-colors duration-150"
                        onClick={() => selectEnd(s)}
                      >
                        {s.display_name}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <label className="text-white/90 flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={useCurrentTime}
                      onChange={(e) => setUseCurrentTime(e.target.checked)}
                      className="w-4 h-4 rounded bg-white/10 border border-white/30 text-blue-400 focus:ring-2 focus:ring-blue-400/50"
                    />
                    Use current time
                  </label>
                </div>

                <div className="space-y-2">
                  <label className="text-white/80 text-xs font-medium">
                    {useCurrentTime ? "Current Date & Time:" : "Select Date & Time:"}
                  </label>
                  <input
                    type="datetime-local"
                    value={customTime}
                    onChange={(e) => setCustomTime(e.target.value)}
                    disabled={useCurrentTime}
                    className={`w-full px-3 py-2.5 text-sm backdrop-blur-sm border rounded-xl transition-all duration-200 ${
                      useCurrentTime
                        ? "bg-white/5 border-white/10 text-white/50 cursor-not-allowed"
                        : "bg-white/10 border-white/20 text-white focus:ring-2 focus:ring-blue-400/50 focus:border-blue-400/50"
                    } focus:outline-none`}
                  />
                  {!useCurrentTime && (
                    <p className="text-white/60 text-xs">Sun calculations will be based on this date and time</p>
                  )}
                </div>
              </div>

              <button
                onClick={drawRouteSun}
                disabled={isLoading}
                className="w-full px-4 py-3 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 disabled:from-gray-500 disabled:to-gray-600 text-white rounded-xl transition-all duration-200 font-medium text-sm shadow-lg hover:shadow-xl disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    Calculating Route...
                  </div>
                ) : (
                  "Draw Sun Route"
                )}
              </button>
            </>
          ) : (
            <div className="text-center space-y-3">
              <div className="text-white/90 text-sm">✅ Route calculated successfully!</div>
              <button
                onClick={resetRoute}
                className="w-full px-4 py-3 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white rounded-xl transition-all duration-200 font-medium text-sm shadow-lg hover:shadow-xl"
              >
                Try Again
              </button>
            </div>
          )}
        </div>
      </div>

      <div
        id="sunPercent"
        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 
                   max-w-[90%] sm:max-w-md backdrop-blur-xl bg-white/10 border border-white/20 p-4 
                   text-white rounded-2xl shadow-2xl text-sm font-medium text-center"
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
          <span>Left: 0% ☀️</span>
          <span style={{ color: 'rgba(255, 255, 255, 0.6)' }}>|</span>
          <span>Right: 0% ☀️</span>
        </div>
      </div>
    </div>
  )
}