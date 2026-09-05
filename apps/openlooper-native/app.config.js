// Expo's default Info.plist template sets `NSAllowsArbitraryLoads: true`, but an
// explicit `ios.infoPlist.NSAppTransportSecurity` in app.json replaces that whole
// dictionary rather than merging into it. `NSAllowsLocalNetworking` alone covers
// RFC 1918, link-local, and `.local` addresses — but not 100.64.0.0/10, the CGNAT
// range Tailscale assigns, so a tailnet address is refused by ATS.
//
// Development builds therefore restore the arbitrary-loads default and add an
// explicit MagicDNS exception. Release builds keep the narrow policy from app.json.
const RELEASE_PROFILES = new Set(['production', 'preview']);
const isReleaseBuild = RELEASE_PROFILES.has(process.env.EAS_BUILD_PROFILE ?? '');

module.exports = ({ config }) => {
  if (isReleaseBuild) return config;
  return {
    ...config,
    ios: {
      ...config.ios,
      infoPlist: {
        ...config.ios?.infoPlist,
        NSAppTransportSecurity: {
          ...config.ios?.infoPlist?.NSAppTransportSecurity,
          NSAllowsArbitraryLoads: true,
          NSExceptionDomains: {
            'ts.net': {
              NSIncludesSubdomains: true,
              NSExceptionAllowsInsecureHTTPLoads: true,
            },
          },
        },
      },
    },
  };
};
