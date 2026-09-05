import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { createGpx } from '../../../../src/domain/gpx';
import type { Activity, RouteResult } from '../../../../src/domain/models';

export async function exportGpx(route: RouteResult, activity: Activity): Promise<void> {
  const contents = createGpx(route, activity);
  const filename = `openlooper-${activity}-${route.distanceKm.toFixed(1)}km.gpx`;
  if (Platform.OS === 'web') {
    const blob = new Blob([contents], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  if (!FileSystem.cacheDirectory) throw new Error('Temporary storage is unavailable.');
  const uri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(uri, contents);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is unavailable on this device.');
  await Sharing.shareAsync(uri, {
    mimeType: 'application/gpx+xml',
    dialogTitle: 'Export OpenLooper route',
    UTI: 'com.topografix.gpx',
  });
}
