import MapView, {
  Marker,
  Polyline,
  type MapPressEvent,
  type MapType,
  type Region,
} from 'react-native-maps';
import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { COLOR } from '@/theme';
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
  route,
  fitRequest,
  alternatives,
  highlightedIssue,
  profilePoint,
  onMapPress,
  onWaypointPress,
  onWaypointMove,
  onIssuePress,
  onEdgePress,
  onAlternativePress,
  onCameraChange,
}: PlannerMapProps) {
  const map = useRef<MapView>(null);
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

  return (
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
      onPress={(event: MapPressEvent) =>
        onMapPress({
          lat: event.nativeEvent.coordinate.latitude,
          lon: event.nativeEvent.coordinate.longitude,
        })
      }
      onRegionChangeComplete={(region: Region) => {
        emittedCenter.current = { lat: region.latitude, lon: region.longitude };
        onCameraChange(
          { lat: region.latitude, lon: region.longitude },
          Math.log2(360 / Math.max(region.longitudeDelta, 0.00001)),
        );
      }}
      onLayout={(event: LayoutChangeEvent) => {
        const { width, height } = event.nativeEvent.layout;
        if (width > 0 && height > 0) size.current = { width, height };
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
          title={
            point.role === 'start'
              ? 'Start'
              : point.role === 'destination'
                ? 'Finish'
                : `Point ${index + 1}`
          }
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
          }}
        >
          <View style={[styles.pin, { backgroundColor: roleColor(point.role) }]}>
            <Text style={styles.pinText}>
              {point.role === 'start'
                ? 'A'
                : point.role === 'destination'
                  ? 'B'
                  : String(index + 1)}
            </Text>
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
  );
}

const styles = StyleSheet.create({
  map: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
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
