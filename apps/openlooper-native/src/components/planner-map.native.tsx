import MapView, { Marker, Polyline, type MapPressEvent } from 'react-native-maps';
import { StyleSheet } from 'react-native';

import type { PlannerMapProps } from './planner-map.types';

export function PlannerMap({ camera, waypoints, onMapPress, onWaypointPress }: PlannerMapProps) {
  return (
    <MapView
      style={styles.map}
      initialRegion={{
        latitude: camera.center.lat,
        longitude: camera.center.lon,
        latitudeDelta: camera.latitudeDelta,
        longitudeDelta: camera.longitudeDelta,
      }}
      onPress={(event: MapPressEvent) =>
        onMapPress({
          lat: event.nativeEvent.coordinate.latitude,
          lon: event.nativeEvent.coordinate.longitude,
        })
      }
      accessibilityLabel="Route planning map"
    >
      {waypoints.length > 1 && (
        <Polyline
          coordinates={waypoints.map(({ coordinate }) => ({
            latitude: coordinate.lat,
            longitude: coordinate.lon,
          }))}
          strokeColor="#273f78"
          strokeWidth={4}
          lineDashPattern={[8, 6]}
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
          onPress={(event) => {
            event.stopPropagation();
            onWaypointPress(point.id);
          }}
        />
      ))}
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
