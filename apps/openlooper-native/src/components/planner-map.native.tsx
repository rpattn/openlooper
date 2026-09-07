import MapView, {
  Marker,
  Polyline,
  type MapPressEvent,
  type MapType,
  type Region,
} from 'react-native-maps';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { COLOR } from '@/theme';
import { waypointLabel, waypointMarker } from '@/domain/waypoints';
import { roleColor } from './ui/waypoint-role';
import type { Coordinate, MapStyleId } from '@/domain/models';
import type { PlannerMapProps } from './planner-map.types';

const nativeCoordinates = (points: Coordinate[]) =>
  points.map((point) => ({ latitude: point.lat, longitude: point.lon }));

// MapKit has no terrain type, so the planner's styles map straight onto the
// four it does support.
const MAP_TYPE: Record<MapStyleId, MapType> = {
  standard: 'standard',
  muted: 'mutedStandard',
  satellite: 'satellite',
  hybrid: 'hybrid',
};

export function PlannerMap({
  activeTool,
  interaction,
  bands,
  showIssues,
  camera,
  mapStyle,
  bottomInset,
  waypoints,
  mode,
  active,
  route,
  fitRequest,
  alternatives,
  highlightedIssue,
  profilePoint,
  onMapPress,
  onWaypointPress,
  onWaypointDelete,
  onWaypointMove,
  onIssuePress,
  onEdgePress,
  onAlternativePress,
  onCameraChange,
}: PlannerMapProps) {
  const map = useRef<MapView>(null);
  // The point whose popup is open, and what is needed to place that popup: the
  // region on screen and the size it is drawn at.
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [region, setRegion] = useState<Region | undefined>(undefined);
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  // Seeded with the region the map mounts at, so the framing effect below does
  // not re-animate over `initialRegion` before the map has been laid out.
  const emittedCenter = useRef<Coordinate | undefined>(camera.center);
  const size = useRef({ width: 0, height: 0 });
  const inset = useRef(bottomInset);
  inset.current = bottomInset;
  const imagery = mapStyle === 'satellite' || mapStyle === 'hybrid';
  const editing = interaction === 'edit';
  // The add tool wants raw map taps; inspecting always prefers the feature tap.
  const readable = !editing || activeTool !== 'add';

  useEffect(() => {
    if (!route?.geometry.length) return;
    map.current?.fitToCoordinates(nativeCoordinates(route.geometry), {
      edgePadding: { top: 110, right: 50, bottom: inset.current + 40, left: 50 },
      animated: true,
    });
  }, [fitRequest, route?.geometry, route?.id]);

  // Framing is done with an explicit region rather than `animateCamera`, so the
  // on-screen scale is exactly what the offset below is calculated against.
  // MapKit ignores `mapPadding` when centring, so the sheet is accounted for by
  // moving the centre south until the target sits in the strip above it.
  useEffect(() => {
    const emitted = emittedCenter.current;
    if (emitted && Math.abs(emitted.lat - camera.center.lat) < 0.00001 && Math.abs(emitted.lon - camera.center.lon) < 0.00001) return;
    const { width, height } = size.current;
    if (width <= 0 || height <= 0) return;
    const longitudeDelta = 360 / 2 ** camera.zoom;
    const latitudeDelta =
      longitudeDelta * Math.cos((camera.center.lat * Math.PI) / 180) * (height / width);
    const shift = (latitudeDelta * Math.min(inset.current, height * 0.8)) / (2 * height);
    map.current?.animateToRegion({
      latitude: camera.center.lat - shift,
      longitude: camera.center.lon,
      latitudeDelta,
      longitudeDelta,
    });
  }, [camera.center.lat, camera.center.lon, camera.zoom]);

  useEffect(() => {
    if (!highlightedIssue?.geometry.length) return;
    map.current?.fitToCoordinates(nativeCoordinates(highlightedIssue.geometry), {
      edgePadding: { top: 130, right: 60, bottom: inset.current + 60, left: 60 },
      animated: true,
    });
  }, [highlightedIssue]);

  const openPoint = active ? waypoints.find((point) => point.id === selected) : undefined;
  const openIndex = openPoint ? waypoints.indexOf(openPoint) : -1;
  // A loop's start is also its finish, and the last point standing cannot go
  // either, so neither offers to be removed.
  const removable = editing && openPoint?.role !== 'start' && waypoints.length > 2;
  const anchor = openPoint && region && layout.width > 0 ? project(openPoint.coordinate, region, layout) : undefined;

  return (
    <View style={styles.root}>
      <MapView
        ref={map}
        style={styles.map}
        mapType={MAP_TYPE[mapStyle]}
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass={false}
        showsScale={false}
        toolbarEnabled={false}
        userInterfaceStyle={imagery ? 'dark' : 'light'}
        initialRegion={{
          latitude: camera.center.lat,
          longitude: camera.center.lon,
          latitudeDelta: 0.1,
          longitudeDelta: 0.12,
        }}
        onPress={(event: MapPressEvent) => {
          // With a popup open the first tap only closes it, so dismissing one
          // never drops a point as a side effect.
          if (selected) {
            setSelected(undefined);
            return;
          }
          onMapPress({
            lat: event.nativeEvent.coordinate.latitude,
            lon: event.nativeEvent.coordinate.longitude,
          });
        }}
        onRegionChangeComplete={(next: Region) => {
          emittedCenter.current = { lat: next.latitude, lon: next.longitude };
          setRegion(next);
          onCameraChange(
            { lat: next.latitude, lon: next.longitude },
            Math.log2(360 / Math.max(next.longitudeDelta, 0.00001)),
          );
        }}
        // The popup is placed against the region, so it is dropped rather than
        // left behind while the map is being moved under it.
        onPanDrag={() => setSelected(undefined)}
        onLayout={(event: LayoutChangeEvent) => {
          const { width, height } = event.nativeEvent.layout;
          if (width > 0 && height > 0) {
            size.current = { width, height };
            setLayout({ width, height });
          }
        }}
        accessibilityLabel="Route planning map"
      >
        {alternatives
          .filter((item) => item.result.id !== route?.id)
          .map((item) => (
            <Polyline
              key={item.id}
              coordinates={nativeCoordinates(item.result.geometry)}
              strokeColor={imagery ? 'rgba(255,255,255,0.5)' : 'rgba(45,54,48,0.34)'}
              strokeWidth={5}
              tappable
              onPress={(event) => {
                event.stopPropagation();
                if (readable) onAlternativePress(item.id);
              }}
            />
          ))}
        {route && (
          <>
            <Polyline
              coordinates={nativeCoordinates(route.geometry)}
              strokeColor="rgba(255,255,255,0.92)"
              strokeWidth={9}
            />
            {bands.map((band, index) => (
              <Polyline
                key={`band-${index}-${band.beginIndex}`}
                coordinates={nativeCoordinates(
                  route.geometry.slice(band.beginIndex, band.endIndex + 1),
                )}
                strokeColor={band.color}
                strokeWidth={5}
              />
            ))}
            {route.edges.map((edge, index) => (
              <Polyline
                key={`edge-${index}`}
                coordinates={nativeCoordinates(
                  route.geometry.slice(edge.beginIndex, edge.endIndex + 1),
                )}
                strokeColor="rgba(0,0,0,0.01)"
                strokeWidth={18}
                tappable
                onPress={(event) => {
                  event.stopPropagation();
                  if (readable) onEdgePress(index);
                }}
              />
            ))}
            {showIssues && route.issues.map((issue) => (
              <Polyline
                key={issue.id}
                coordinates={nativeCoordinates(issue.geometry)}
                strokeColor={issue.severity === 'high' ? COLOR.danger : COLOR.warning}
                strokeWidth={7}
                tappable
                onPress={(event) => {
                  event.stopPropagation();
                  if (readable) onIssuePress(issue.id);
                }}
              />
            ))}
          </>
        )}
        {!route && waypoints.length > 1 && (
          <Polyline
            coordinates={nativeCoordinates(waypoints.map((point) => point.coordinate))}
            strokeColor={COLOR.via}
            strokeWidth={4}
            lineDashPattern={[8, 6]}
          />
        )}
        {highlightedIssue && (
          <Polyline
            coordinates={nativeCoordinates(highlightedIssue.geometry)}
            strokeColor={COLOR.highlight}
            strokeWidth={10}
          />
        )}
        {waypoints.map((point, index) => (
            <Marker
              key={point.id}
              coordinate={{ latitude: point.coordinate.lat, longitude: point.coordinate.lon }}
              anchor={{ x: 0.5, y: 0.5 }}
              // No `title`: MapKit presents a callout of its own for any marker
              // that has one, which showed a second copy of the name under the
              // popup the planner draws itself.
              draggable={editing}
              onDragEnd={(event) =>
                onWaypointMove(point.id, {
                  lat: event.nativeEvent.coordinate.latitude,
                  lon: event.nativeEvent.coordinate.longitude,
                })
              }
              onPress={(event) => {
                event.stopPropagation();
                onWaypointPress(point.id);
                setSelected((current) => (current === point.id ? undefined : point.id));
              }}
            >
              <View style={[styles.pin, { backgroundColor: roleColor(point.role) }]}>
                <Text style={styles.pinText}>{waypointMarker(point.role, index)}</Text>
              </View>
            </Marker>
        ))}
        {profilePoint && (
          <Marker
            coordinate={{ latitude: profilePoint.lat, longitude: profilePoint.lon }}
            anchor={{ x: 0.5, y: 0.5 }}
            title="Elevation profile position"
          >
            <View style={styles.profilePin} />
          </Marker>
        )}
      </MapView>
      {/* The point's popup, drawn over the map rather than as a MapKit callout.
          A callout is presented outside its marker's bounds, and the tap handler
          that would reach anything inside it hangs off the marker, so a button in
          there never receives the touch. Placing it here keeps the layout and the
          touch targets ours. */}
      {!!openPoint && !!anchor && (
        <View pointerEvents="box-none" style={styles.overlay}>
          <View
            style={[
              styles.popup,
              {
                left: Math.max(8, Math.min(layout.width - POPUP_WIDTH - 8, anchor.x - POPUP_WIDTH / 2)),
                top: anchor.y - POPUP_HEIGHT - 26,
              },
            ]}
          >
            <Text style={styles.popupText} numberOfLines={1}>
              {waypointLabel(mode, openPoint.role, openIndex)}
            </Text>
            {removable && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${waypointLabel(mode, openPoint.role, openIndex)}`}
                hitSlop={8}
                onPress={() => {
                  setSelected(undefined);
                  onWaypointDelete(openPoint.id);
                }}
                style={({ pressed }) => [styles.remove, pressed && styles.removePressed]}
              >
                <Text style={styles.removeText}>✕</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

/**
 * Where a coordinate lands on screen. Over a single screen's span the flat
 * mapping is accurate to well under a pixel, which is all a popup anchor needs.
 */
function project(point: Coordinate, region: Region, layout: { width: number; height: number }) {
  return {
    x: layout.width * (0.5 + (point.lon - region.longitude) / region.longitudeDelta),
    y: layout.height * (0.5 - (point.lat - region.latitude) / region.latitudeDelta),
  };
}

const POPUP_WIDTH = 190;
const POPUP_HEIGHT = 44;

const styles = StyleSheet.create({
  root: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  map: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  popup: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    width: POPUP_WIDTH,
    height: POPUP_HEIGHT,
    gap: 10,
    paddingLeft: 13,
    paddingRight: 6,
    borderRadius: 14,
    backgroundColor: COLOR.surface,
    shadowColor: '#0b120d',
    shadowOpacity: 0.24,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  popupText: { flex: 1, color: COLOR.ink, fontSize: 13, fontWeight: '800' },
  remove: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: COLOR.danger,
  },
  removePressed: { opacity: 0.7 },
  removeText: { color: '#fff', fontSize: 13, fontWeight: '900', lineHeight: 16 },
  pin: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    borderWidth: 2.5,
    borderColor: '#fff',
    shadowColor: '#0b120d',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  pinText: { color: '#fff', fontSize: 11, fontWeight: '900' },
  profilePin: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 3,
    borderColor: '#fff',
    backgroundColor: '#111',
  },
});
