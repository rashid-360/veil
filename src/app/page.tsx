"use client";

import dynamic from "next/dynamic";

// Dynamically import the map component to prevent SSR issues
const MapWithSunRoute = dynamic(() => import("./map/MapWithSunRoute"), {
  ssr: false, // 🚀 disables server-side rendering
});

export default function MapPage() {
  return <MapWithSunRoute />;
}
