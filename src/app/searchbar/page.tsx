"use client"

import { useState } from "react";

export default function SearchBar({ setPosition }: any) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);

  const handleSearch = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);

    if (value.length > 2) {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${value}`
      );
      const data = await res.json();
      setResults(data);
    } else {
      setResults([]);
    }
  };

  return (
    <div style={{ position: "absolute", top: 10, left: 10, zIndex: 1000 }}>
      <input
        type="text"
        value={query}
        onChange={handleSearch}
        placeholder="Search place..."
        style={{ padding: "5px", width: "200px" }}
      />
      <ul style={{ background: "white", padding: 0 }}>
        {results.map((place) => (
          <li
            key={place.place_id}
            onClick={() => {
              setPosition([parseFloat(place.lat), parseFloat(place.lon)]);
              setQuery(place.display_name);
              setResults([]);
            }}
            style={{ cursor: "pointer", padding: "5px", listStyle: "none" }}
          >
            {place.display_name}
          </li>
        ))}
      </ul>
    </div>
  );
}
