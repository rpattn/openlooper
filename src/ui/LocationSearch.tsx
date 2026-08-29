import { Search, X } from "lucide-react";
import { useRef, useState } from "react";
import type { Coordinate } from "../domain/models";

const ENDPOINT =
  import.meta.env.VITE_NOMINATIM_URL ?? "https://nominatim.openstreetmap.org";
type Result = {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
};
const CACHE_KEY = "openlooper-search-cache";
function readCache(): Map<string, Result[]> {
  try {
    const saved = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "[]") as Array<
      [string, Result[]]
    >;
    return new Map(Array.isArray(saved) ? saved.slice(-10) : []);
  } catch {
    return new Map();
  }
}
const cache = readCache();
function saveCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify([...cache].slice(-10)));
  } catch {
    /* Search remains usable without storage. */
  }
}
let lastRequest = 0;

export function LocationSearch({
  viewbox,
  onSelect,
}: {
  viewbox?: [Coordinate, Coordinate];
  onSelect: (coordinate: Coordinate, label: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const waiting = useRef<number | undefined>(undefined);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const cacheKey = query.trim().toLowerCase();
    if (!cacheKey) return;
    setError("");
    setOpen(true);
    if (cache.has(cacheKey)) {
      setResults(cache.get(cacheKey)!);
      return;
    }
    const delay = Math.max(0, 1000 - (Date.now() - lastRequest));
    window.clearTimeout(waiting.current);
    waiting.current = window.setTimeout(async () => {
      try {
        lastRequest = Date.now();
        const params = new URLSearchParams({
          q: query.trim(),
          format: "jsonv2",
          limit: "5",
        });
        if (viewbox)
          params.set(
            "viewbox",
            `${viewbox[0].lon},${viewbox[1].lat},${viewbox[1].lon},${viewbox[0].lat}`,
          );
        const response = await fetch(`${ENDPOINT}/search?${params}`, {
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error();
        const found = (await response.json()) as Result[];
        cache.set(cacheKey, found);
        saveCache();
        setResults(found);
        if (!found.length)
          setError("No places found. You can still choose a point on the map.");
      } catch {
        setError("Search is unavailable. Choose a point on the map instead.");
      }
    }, delay);
  }

  return (
    <div className="search">
      <form onSubmit={submit}>
        <Search size={18} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a place"
          aria-label="Find a place"
        />
        <button type="submit">Search</button>
        {open && (
          <button
            type="button"
            className="icon-button"
            aria-label="Close search"
            onClick={() => setOpen(false)}
          >
            <X size={18} />
          </button>
        )}
      </form>
      {open && (
        <div className="search-results">
          {error && <p className="status status--error">{error}</p>}
          {results.map((item) => (
            <button
              key={item.place_id}
              onClick={() => {
                onSelect(
                  { lat: Number(item.lat), lon: Number(item.lon) },
                  item.display_name,
                );
                setOpen(false);
              }}
            >
              {item.display_name}
            </button>
          ))}
          <small>Search data © OpenStreetMap contributors via Nominatim</small>
        </div>
      )}
    </div>
  );
}
