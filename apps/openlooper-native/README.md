# OpenLooper Expo client

This is the universal Expo SDK 57 frontend for OpenLooper. Android and iOS use `react-native-maps`; web uses MapLibre and OpenFreeMap. Routing, analysis, and loop-scoring logic is shared with the original web prototype under `../../src`.

## Run it

From the repository root:

```sh
npm run native
npm run native:web
npm run native:check
```

Or run `npm run android`, `npm run ios`, or `npm run web` from this directory.

The app supports A→B alternatives, waypoint sketching, automatic loop generation, route preferences, draggable editing, local session restoration, location search, device location, elevation, route-quality notes and segment details, route-use evidence ranking, and GPX export/sharing. Development builds also expose loop-scoring sliders. The development evidence map overlay from the original frontend is intentionally not included.

## Talking to the local services

Start Valhalla and the evidence service from the repository root first:

```sh
npm run routing:up && npm run evidence:up
```

Neither service answers CORS preflight requests, so the two platforms reach them differently and both work with no configuration:

- **Web.** `metro.config.js` adds a dev-server proxy that forwards `/api/valhalla/*` to `127.0.0.1:8002` and `/api/evidence/*` to `127.0.0.1:8003`, mirroring the Vite proxy. Requests stay same-origin, so preflight never happens. Set `OPENLOOPER_SERVICE_HOST` when the services run on another machine.
- **Native.** `src/services/endpoints.ts` derives the service host from the Metro bundle URL (`Constants.expoConfig.hostUri`) and calls ports 8002 and 8003 on it directly. React Native does not apply CORS. A simulator on the same machine and a phone loading the bundle over the LAN both resolve to the right host.

Override either endpoint when that inference is wrong — a standalone build with no dev server, a tunnelled dev server, or services hosted apart from the bundle:

```sh
EXPO_PUBLIC_VALHALLA_URL=http://192.168.1.10:8002
EXPO_PUBLIC_EVIDENCE_URL=http://192.168.1.10:8003
```

`EXPO_PUBLIC_NOMINATIM_URL` can optionally replace the default OpenStreetMap Nominatim endpoint. Copy `.env.example` to `.env` to set any of these. Confirm both services from this machine with `curl http://127.0.0.1:8002/status` and `curl http://127.0.0.1:8003/status`.

### Reaching the services from a physical phone

The phone must reach the Metro dev server on port 8081 and the two services on 8002 and 8003. Under WSL2 that depends on the networking mode.

**With WSL mirrored networking**, the WSL VM shares the Windows host's interfaces, so it already answers on the host's LAN address and nothing needs forwarding. Put the phone on the same Wi-Fi and start Metro on that address:

```sh
REACT_NATIVE_PACKAGER_HOSTNAME=<windows-lan-ip> npm run start:lan
```

Scan the QR code. `hostUri` becomes `<windows-lan-ip>:8081`, so routing and evidence resolve to `:8002` and `:8003` on the same address with no further configuration. A LAN address is also RFC 1918, which every build's ATS policy already permits — unlike a VPN address, it never depends on the development ATS relaxation.

Naming the host explicitly matters here: a mirrored VM sees every host interface, so Expo's "first non-internal IPv4" can just as easily land on a Hyper-V or VPN adapter as on Wi-Fi.

Confirm the mode with `ip -4 -o addr show`. A mirrored VM carries the host's LAN address; an unmirrored one shows only its own NAT address (`172.x`).

#### Enabling mirrored networking

Add to `%UserProfile%\.wslconfig`, keeping any settings already there:

```ini
[wsl2]
networkingMode=mirrored

[experimental]
hostAddressLoopback=true
```

Inbound traffic to a mirrored VM passes the Hyper-V firewall, which drops it by default. In an elevated PowerShell:

```powershell
Set-NetFirewallHyperVVMSetting -Name '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}' -DefaultInboundAction Allow
New-NetFirewallRule -DisplayName 'WSL Expo dev' -Direction Inbound -Action Allow `
  -Protocol TCP -LocalPort 8081,8002,8003 -Profile Private
```

Clear any port forwarding first — a mirrored VM binds ports on the host's own stack, so a proxy already listening on `0.0.0.0:8081` makes Metro fail to start with `EADDRINUSE`:

```powershell
netsh interface portproxy reset
```

Then `wsl --shutdown` and reopen the shell. The restart stops the dev server and the service containers, so bring the services back up with `npm run routing:up && npm run evidence:up` from the repository root.

#### Without mirrored networking

Forward the three ports from the Windows LAN address to the WSL VM instead. This applies immediately and needs no restart. In an elevated PowerShell, with `<wsl-ip>` from `hostname -I` and the Wi-Fi profile set to Private:

```powershell
$wsl = '<wsl-ip>'
8081,8002,8003 | ForEach-Object {
  netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=$_ connectaddress=$wsl connectport=$_
}
New-NetFirewallRule -DisplayName 'WSL Expo dev' -Direction Inbound -Action Allow `
  -Protocol TCP -LocalPort 8081,8002,8003 -Profile Private
```

Start Metro with `REACT_NATIVE_PACKAGER_HOSTNAME=<windows-lan-ip>` as above. The WSL address changes when WSL restarts, which leaves the rules pointing at nothing — re-run the block with the new address after `netsh interface portproxy reset`.

#### Testing away from the LAN

Tailscale (or any VPN putting both devices on one network) reaches the dev machine from anywhere:

```sh
REACT_NATIVE_PACKAGER_HOSTNAME=<tailnet-ip> npm run start:lan
```

Tailscale assigns addresses from `100.64.0.0/10`, which `NSAllowsLocalNetworking` does **not** cover, so this path works only on a build carrying the development ATS policy described below.

On macOS or native Linux the LAN address works directly and none of this applies.

## iOS development build

The app now uses `expo-dev-client`, `react-native-maps`, and `expo-location`, none of which run in Expo Go — you need a development build. WSL2 has no Xcode, so build in the cloud with EAS.

You need a free Expo account and, for a build that installs on a real iPhone, a paid Apple Developer account ($99/year). Without one, use the simulator profile below on a Mac.

**1. Sign in and link the project.** From this directory:

```sh
npx eas login
npx eas init
```

`eas init` writes `extra.eas.projectId` into `app.json`; commit that.

**2. Register the iPhone.** Internal distribution embeds the device UDID in the provisioning profile:

```sh
npx eas device:create
```

Choose the website/QR option, open the link on the iPhone, and install the profile it offers (Settings then shows it under **Profile Downloaded**). Repeat once per device.

**3. Build.**

```sh
npx eas build --profile development --platform ios
```

EAS prompts for your Apple ID the first time and creates the bundle identifier `com.openlooper.app`, the distribution certificate, and the provisioning profile for you. The build takes roughly 10–20 minutes.

**4. Install.** When it finishes, EAS prints a build page URL and a QR code. Open that URL on the iPhone (or scan the code) and tap **Install**. The dev client lands on the home screen as *OpenLooper*.

**5. Run against your machine.** With the services up and Metro running:

```sh
npm run start:lan
```

Open the dev client on the phone and pick the dev server, or scan the QR code Metro prints. Use the `REACT_NATIVE_PACKAGER_HOSTNAME` form above when the phone reaches you over a VPN.

### When the phone times out connecting

Check these in order:

1. **The address Expo advertised.** Plain `expo start` prints the first non-internal IPv4 it finds. Unmirrored, that is the WSL NAT address (`172.x`), which nothing outside WSL can route to; mirrored, it is whichever host interface happens to come first, often a Hyper-V or VPN adapter rather than Wi-Fi. Either way the QR code can encode an address the phone cannot reach. Start with `REACT_NATIVE_PACKAGER_HOSTNAME` set, or use **Enter URL manually** in the dev client.
2. **Something is listening where the phone is looking.** Port forwarding breaks silently whenever the WSL address changes, and `netsh interface portproxy show all` still lists the stale rule. Mirrored setups instead fail at bind time: a leftover proxy holding `0.0.0.0:8081` stops Metro with `EADDRINUSE`.
3. **On a VPN, that the phone is really on it.** `tailscale status --json` reports `Online: false` for a node whose toggle is off, and an offline node times out identically to a wrong address. `tailscale ping <device>` confirms a live path.
4. **`App Transport Security policy requires the use of a secure connection`.** The connection reached the server; iOS refused the cleartext load. A VPN address in `100.64.0.0/10` needs the development ATS policy above, which lives in the Info.plist — so it takes a new build, not a restart. Connecting over an RFC 1918 address instead works with any build, which makes LAN the more forgiving option of the two.
5. **The dev server and services answer on the address the phone uses.** Run `curl http://<address>:8081/status`, `:8002/status`, and `:8003/status` against that exact address, not `127.0.0.1` — localhost proves only that the process is up, not that it is reachable. Metro binds every interface by default, and both compose files publish on `0.0.0.0`. Loading one of those URLs in the phone's own browser separates a network problem from an app one, since Safari applies neither the app's ATS policy nor its local-network permission.

The service host does not need configuring for any of this. Expo derives `hostUri` from the `Host` header of the request the phone made, so a phone that loaded the bundle from `100.x.y.z:8081` resolves routing and evidence to `100.x.y.z:8002` and `:8003` on its own.

`--tunnel` is the one case that breaks that inference: it forwards only port 8081, and `hostUri` becomes a public tunnel domain where the services do not exist. Set `EXPO_PUBLIC_VALHALLA_URL` and `EXPO_PUBLIC_EVIDENCE_URL` explicitly when tunnelling.

The dev client is reusable — after the install step you only rebuild when native dependencies or `app.json`'s native configuration change. JavaScript changes reload over Metro.

### Simulator build (Mac only)

```sh
npx eas build --profile development-simulator --platform ios
```

Download the resulting `.tar.gz`, extract it, and drag the `.app` onto a running simulator, or run `npx eas build:run -p ios` to have EAS install it.

### Other profiles

`preview` produces a standalone internal-distribution build with no dev server attached. `hostUri` is undefined there, so the service URLs must be baked in:

```sh
EXPO_PUBLIC_VALHALLA_URL=http://... EXPO_PUBLIC_EVIDENCE_URL=http://... npx eas build --profile preview --platform ios
```

### Why the app.json entries exist

- `ios.bundleIdentifier` / `android.package` — required for any native build.
- `NSAppTransportSecurity` — iOS blocks cleartext HTTP by default. `NSAllowsLocalNetworking` in `app.json` covers RFC 1918, link-local, and `.local` addresses. It does **not** cover `100.64.0.0/10`, the carrier-grade NAT range Tailscale assigns, so `app.config.js` restores `NSAllowsArbitraryLoads` (Expo's own default, which an explicit `NSAppTransportSecurity` dictionary otherwise replaces) and adds a `ts.net` exception for every build profile except `preview` and `production`.
- `NSLocalNetworkUsageDescription` — iOS 14+ prompts before an app may contact hosts on the local network.
- `NSLocationWhenInUseUsageDescription`, via the `expo-location` plugin — needed by the **Locate me** control.
- `expo-build-properties` with `usesCleartextTraffic` — the Android equivalent of the ATS exception.

Android additionally needs a Google Maps API key for `react-native-maps`; iOS uses Apple Maps and needs none.
