import { useRef, useState } from "react";
import type { Coordinate, ElevationPoint } from "../domain/models";

export function ElevationProfile({
  points,
  onPoint,
}: {
  points: ElevationPoint[];
  onPoint: (point?: Coordinate) => void;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const [pinned, setPinned] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number>();
  if (!points.length)
    return (
      <div className="empty-small">
        Elevation is unavailable for this route. Routing remains usable.
      </div>
    );
  const width = 600,
    height = 150,
    pad = 24;
  const min = Math.min(...points.map((p) => p.elevationM)),
    max = Math.max(...points.map((p) => p.elevationM));
  const range = Math.max(1, max - min),
    distance = points.at(-1)?.distanceKm ?? 1;
  const xy = (p: ElevationPoint) => [
    pad + (p.distanceKm / distance) * (width - pad * 2),
    height - pad - ((p.elevationM - min) / range) * (height - pad * 2),
  ];
  const path = points
    .map((p, i) => `${i ? "L" : "M"}${xy(p).join(",")}`)
    .join(" ");
  const area = `${path} L${width - pad},${height - pad} L${pad},${height - pad} Z`;
  function move(clientX: number) {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const ratio = Math.max(0, Math.min(1, (clientX - box.left) / box.width));
    const index = Math.round(ratio * (points.length - 1));
    setSelectedIndex(index);
    onPoint(points[index]?.coordinate);
  }
  function show(index: number) {
    const next = Math.max(0, Math.min(points.length - 1, index));
    setSelectedIndex(next);
    setPinned(true);
    onPoint(points[next]?.coordinate);
  }
  return (
    <div className="elevation">
      <svg
        ref={ref}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Elevation profile from ${Math.round(min)} to ${Math.round(max)} metres`}
        tabIndex={0}
        onPointerMove={(e) => {
          if (dragging.current || !pinned) move(e.clientX);
        }}
        onPointerLeave={() => {
          if (!pinned && !dragging.current) {
            setSelectedIndex(undefined);
            onPoint();
          }
        }}
        onPointerDown={(e) => {
          if (pinned) {
            setPinned(false);
            setSelectedIndex(undefined);
            onPoint();
            return;
          }
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          move(e.clientX);
          setPinned(true);
        }}
        onPointerUp={(e) => {
          dragging.current = false;
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onKeyDown={(e) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(e.key))
            return;
          e.preventDefault();
          if (e.key === "Escape") {
            setPinned(false);
            setSelectedIndex(undefined);
            onPoint();
          } else if (e.key === "Home") show(0);
          else if (e.key === "End") show(points.length - 1);
          else
            show(
              (selectedIndex ?? 0) + (e.key === "ArrowLeft" ? -1 : 1),
            );
        }}
      >
        <path d={area} className="elevation-area" />
        <path d={path} className="elevation-line" />
        <text x={pad} y={16}>
          {Math.round(max)} m
        </text>
        <text x={pad} y={height - 5}>
          0 km
        </text>
        <text x={width - pad} y={height - 5} textAnchor="end">
          {distance.toFixed(1)} km
        </text>
      </svg>
      <small aria-live="polite">
        {selectedIndex === undefined
          ? "Move across the profile to locate elevation on the map. Tap to pin."
          : `${points[selectedIndex]!.distanceKm.toFixed(1)} km · ${Math.round(points[selectedIndex]!.elevationM)} m elevation${pinned ? " · pinned" : ""}`}
      </small>
    </div>
  );
}
