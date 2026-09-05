# OpenLooper Expo client

This is the universal Expo SDK 57 frontend for OpenLooper. Android and iOS use `react-native-maps`; web uses MapLibre and OpenFreeMap. Routing, analysis, and loop-scoring logic is shared with the original web prototype.

## Run it

From the repository root:

```sh
npm run native
npm run native:web
npm run native:check
```

Or run `npm run android`, `npm run ios`, or `npm run web` from this directory.

The app supports A→B alternatives, waypoint sketching, automatic loop generation, route preferences, draggable editing, local session restoration, location search, device location, elevation, route-quality notes and segment details, route-use evidence ranking, and GPX export/sharing. Development builds also expose loop-scoring sliders. The development evidence map overlay from the original frontend is intentionally not included.

## Local services

The web build defaults to `/api/valhalla` and `/api/evidence`. Native builds default to ports `8002` and `8003` on `127.0.0.1`, which works for an iOS simulator but not a physical phone. Set these variables to a development machine address reachable from the device:

```sh
EXPO_PUBLIC_VALHALLA_URL=http://192.168.1.10:8002
EXPO_PUBLIC_EVIDENCE_URL=http://192.168.1.10:8003
```

`EXPO_PUBLIC_NOMINATIM_URL` can optionally replace the default OpenStreetMap Nominatim endpoint.

Start the local route and evidence services from the repository root using the documented `routing:*` and `evidence:*` scripts.
