import MapView, {
  Marker,
  Polyline,
  type MapPressEvent,
  type Region,
} from 'react-native-maps';
import { useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';

import { ACTIVITY, type Coordinate } from '@/domain/models';
import type { PlannerMapProps } from './planner-map.types';

const nativeCoordinates = (points: Coordinate[]) =>
  points.map((point) => ({ latitude: point.lat, longitude: point.lon }));

export function PlannerMap({
  activity,
  activeTool,
  camera,
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
  const emittedCenter = useRef<Coordinate | undefined>(undefined);

  useEffect(() => {
    if (!route?.geometry.length) return;
    map.current?.fitToCoordinates(nativeCoordinates(route.geometry), {
      edgePadding: { top: 80, right: 50, bottom: 320, left: 50 },
      animated: true,
    });
  }, [fitRequest, route?.geometry, route?.id]);

  useEffect(() => {
    const emitted = emittedCenter.current;
    if (emitted && Math.abs(emitted.lat - camera.center.lat) < 0.00001 && Math.abs(emitted.lon - camera.center.lon) < 0.00001) return;
    map.current?.animateCamera({
      center: { latitude: camera.center.lat, longitude: camera.center.lon },
      zoom: camera.zoom,
    });
  }, [camera.center.lat, camera.center.lon, camera.zoom]);

  useEffect(() => {
    if (!highlightedIssue?.geometry.length) return;
    map.current?.fitToCoordinates(nativeCoordinates(highlightedIssue.geometry), {
      edgePadding: { top: 100, right: 60, bottom: 340, left: 60 },
      animated: true,
    });
  }, [highlightedIssue]);

  return (
    <MapView
      ref={map}
      style={styles.map}
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
      accessibilityLabel="Route planning map"
    >
      {alternatives
        .filter((item) => item.result.id !== route?.id)
        .map((item) => (
          <Polyline
            key={item.id}
            coordinates={nativeCoordinates(item.result.geometry)}
            strokeColor="rgba(45,54,48,0.34)"
            strokeWidth={5}
            tappable
            onPress={(event) => {
              event.stopPropagation();
              if (activeTool !== 'add') onAlternativePress(item.id);
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
          <Polyline
            coordinates={nativeCoordinates(route.geometry)}
            strokeColor={ACTIVITY[activity].color}
            strokeWidth={5}
          />
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
                if (activeTool !== 'add') onEdgePress(index);
              }}
            />
          ))}
          {route.issues.map((issue) => (
            <Polyline
              key={issue.id}
              coordinates={nativeCoordinates(issue.geometry)}
              strokeColor={issue.severity === 'high' ? '#b3261e' : '#d77b16'}
              strokeWidth={7}
              tappable
              onPress={(event) => {
                event.stopPropagation();
                if (activeTool !== 'add') onIssuePress(issue.id);
              }}
            />
          ))}
        </>
      )}
      {!route && waypoints.length > 1 && (
        <Polyline
          coordinates={nativeCoordinates(waypoints.map((point) => point.coordinate))}
          strokeColor="#273f78"
          strokeWidth={4}
          lineDashPattern={[8, 6]}
        />
      )}
      {highlightedIssue && (
        <Polyline
          coordinates={nativeCoordinates(highlightedIssue.geometry)}
          strokeColor="#ffd24a"
          strokeWidth={10}
        />
      )}
      {waypoints.map((point, index) => (
        <Marker
          key={point.id}
          coordinate={{ latitude: point.coordinate.lat, longitude: point.coordinate.lon }}
          title={
            point.role === 'start'
              ? 'Start'
              : point.role === 'destination'
                ? 'Finish'
                : `Point ${index + 1}`
          }
          pinColor={
            point.role === 'start'
              ? '#177657'
              : point.role === 'destination'
                ? '#b83c34'
                : '#273f78'
          }
          draggable
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
        />
      ))}
      {profilePoint && (
        <Marker
          coordinate={{ latitude: profilePoint.lat, longitude: profilePoint.lon }}
          pinColor="#111"
          title="Elevation profile position"
        />
      )}
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
});
