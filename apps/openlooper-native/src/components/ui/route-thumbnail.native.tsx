import MapView, { Polyline } from 'react-native-maps';
import { StyleSheet, View } from 'react-native';

import { COLOR, RADIUS } from '@/theme';
import type { Coordinate } from '@/domain/models';
import type { RouteThumbnailProps } from './route-thumbnail.types';

/** Breathing room around the route inside the card. */
const FRAME = 1.4;
/**
 * How far the map is drawn beyond the card on every side. MapKit puts its legal
 * link in a corner of whatever view it is given, and a card is too small to
 * carry it legibly, so the map is oversized and the card clips the border away.
 * Apple's attribution stays where it can actually be read: the full map screen.
 */
const BLEED = 28;

/**
 * Card-sized map with the route drawn on it. `cacheEnabled` renders the map as
 * a still image rather than a live one, so a page of cards costs a page of
 * pictures; nothing here is interactive, and taps fall through to the card.
 */
export function RouteThumbnail({ outline, accent, size = 92 }: RouteThumbnailProps) {
  const region = regionFor(outline, size);
  const line = outline.map((point) => ({ latitude: point.lat, longitude: point.lon }));
  return (
    <View style={[styles.tile, { width: size, height: size }]} pointerEvents="none">
      {!!region && (
        <MapView
          style={styles.map}
          initialRegion={region}
          mapType="mutedStandard"
          cacheEnabled
          scrollEnabled={false}
          zoomEnabled={false}
          rotateEnabled={false}
          pitchEnabled={false}
          toolbarEnabled={false}
          showsCompass={false}
          showsScale={false}
          showsPointsOfInterests={false}
          showsBuildings={false}
          userInterfaceStyle="light"
        >
          <Polyline coordinates={line} strokeColor="rgba(255,255,255,0.9)" strokeWidth={5} />
          <Polyline coordinates={line} strokeColor={accent} strokeWidth={2.5} />
        </MapView>
      )}
    </View>
  );
}

function regionFor(outline: Coordinate[], size: number) {
  if (outline.length < 2) return undefined;
  // The region covers the oversized map, so it is widened by however much of it
  // the card hides; what stays visible then frames the route as intended.
  const bleed = (size + BLEED * 2) / size;
  const lats = outline.map((point) => point.lat);
  const lons = outline.map((point) => point.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
    // A floor keeps a very short route from filling the card with one street.
    latitudeDelta: Math.max((maxLat - minLat) * FRAME, 0.004) * bleed,
    longitudeDelta: Math.max((maxLon - minLon) * FRAME, 0.004) * bleed,
  };
}

const styles = StyleSheet.create({
  map: { position: 'absolute', top: -BLEED, right: -BLEED, bottom: -BLEED, left: -BLEED },
  tile: {
    overflow: 'hidden',
    borderRadius: RADIUS.control,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLOR.line,
    backgroundColor: '#e6ebe3',
  },
});
