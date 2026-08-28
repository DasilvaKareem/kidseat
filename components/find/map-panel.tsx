"use client";

import { useEffect } from "react";
import {
  APIProvider,
  Map,
  AdvancedMarker,
  Pin,
  useMap,
} from "@vis.gl/react-google-maps";
import type { Bounds, MapItem } from "./types";

const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;
// AdvancedMarker needs a Map ID. Google's DEMO_MAP_ID works for development;
// create a real one in Cloud Console for production styling.
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ?? "DEMO_MAP_ID";

const SF = { lat: 37.7749, lng: -122.4194 };

/** Recenters when the list selection changes, without fighting the user's pan. */
function SelectionFollower({ item }: { item: MapItem | null }) {
  const map = useMap();
  useEffect(() => {
    if (!map || !item) return;
    map.panTo({ lat: item.lat, lng: item.lon });
  }, [map, item]);
  return null;
}

export default function MapPanel({
  items,
  selectedId,
  hoveredId,
  onSelect,
  onBounds,
  unavailableLabel,
}: {
  items: MapItem[];
  selectedId: string | null;
  hoveredId: string | null;
  onSelect: (id: string) => void;
  onBounds: (b: Bounds) => void;
  unavailableLabel: string;
}) {
  if (!KEY) {
    return (
      <div className="flex h-full items-center justify-center bg-line/30 p-6 text-center text-[17px] text-muted">
        {unavailableLabel}
      </div>
    );
  }

  const selected = items.find((i) => i.id === selectedId) ?? null;

  return (
    <APIProvider apiKey={KEY}>
      <Map
        mapId={MAP_ID}
        defaultCenter={SF}
        defaultZoom={13}
        gestureHandling="greedy"
        disableDefaultUI
        zoomControl
        className="h-full w-full"
        onCameraChanged={(e) => {
          const b = e.detail.bounds;
          if (b) onBounds(b);
        }}
      >
        <SelectionFollower item={selected} />
        {items.map((item) => {
          const active = item.id === selectedId || item.id === hoveredId;
          return (
            <AdvancedMarker
              key={item.id}
              position={{ lat: item.lat, lng: item.lon }}
              onClick={() => onSelect(item.id)}
              zIndex={active ? 10 : 1}
              title={item.name}
            >
              {/* Events get the brand colour and a bigger pin: a time you can
                  show up at outranks a general listing. */}
              <Pin
                background={item.kind === "event" ? "#14663f" : "#ffffff"}
                borderColor={active ? "#1b1714" : "#14663f"}
                glyphColor={item.kind === "event" ? "#ffffff" : "#14663f"}
                scale={active ? 1.4 : item.kind === "event" ? 1.15 : 1}
              />
            </AdvancedMarker>
          );
        })}
      </Map>
    </APIProvider>
  );
}
