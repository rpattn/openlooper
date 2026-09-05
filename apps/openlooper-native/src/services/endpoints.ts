import Constants from 'expo-constants';
import { Platform } from 'react-native';

const VALHALLA_PORT = 8002;
const EVIDENCE_PORT = 8003;

/**
 * Host serving the Metro bundle. On a physical device that is the development
 * machine's LAN address, which is also where the local services are listening;
 * `127.0.0.1` would resolve to the phone itself.
 */
function devHost(): string {
  const raw = Constants.expoConfig?.hostUri ?? Constants.expoGoConfig?.debuggerHost ?? '';
  const host = raw
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .split('/')[0]!
    .replace(/:\d+$/, '');
  return host || '127.0.0.1';
}

function endpoint(override: string | undefined, webPath: string, port: number): string {
  if (override) return override.replace(/\/+$/, '');
  // Web goes through the dev-server proxy in metro.config.js, which keeps the
  // request same-origin; neither service answers CORS preflight requests.
  if (Platform.OS === 'web') return webPath;
  return `http://${devHost()}:${port}`;
}

export const VALHALLA_URL = endpoint(
  process.env.EXPO_PUBLIC_VALHALLA_URL,
  '/api/valhalla',
  VALHALLA_PORT,
);

export const EVIDENCE_URL = endpoint(
  process.env.EXPO_PUBLIC_EVIDENCE_URL,
  '/api/evidence',
  EVIDENCE_PORT,
);

export const NOMINATIM_URL = (
  process.env.EXPO_PUBLIC_NOMINATIM_URL ?? 'https://nominatim.openstreetmap.org'
).replace(/\/+$/, '');
