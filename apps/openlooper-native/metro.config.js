const http = require('http');
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Neither local service answers CORS preflight requests, so the web build calls
// them through same-origin paths that the dev server forwards. Native builds
// talk to the services directly and never reach this proxy.
const SERVICE_HOST = process.env.OPENLOOPER_SERVICE_HOST ?? '127.0.0.1';
const PROXIES = [
  { prefix: '/api/valhalla', port: Number(process.env.OPENLOOPER_VALHALLA_PORT ?? 8002) },
  { prefix: '/api/evidence', port: Number(process.env.OPENLOOPER_EVIDENCE_PORT ?? 8003) },
];

function matchProxy(url) {
  if (!url) return undefined;
  const [pathname] = url.split('?');
  return PROXIES.find(
    (proxy) => pathname === proxy.prefix || pathname.startsWith(`${proxy.prefix}/`),
  );
}

function forward(proxy, req, res) {
  const upstream = http.request(
    {
      host: SERVICE_HOST,
      port: proxy.port,
      method: req.method,
      path: req.url.slice(proxy.prefix.length) || '/',
      headers: { ...req.headers, host: `${SERVICE_HOST}:${proxy.port}` },
    },
    (upstreamResponse) => {
      res.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(res);
    },
  );
  upstream.on('error', (error) => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: `Cannot reach ${proxy.prefix} at ${SERVICE_HOST}:${proxy.port} (${error.message}). Start the local services from the repository root.`,
      }),
    );
  });
  req.pipe(upstream);
}

config.server = {
  ...config.server,
  enhanceMiddleware: (metroMiddleware) => (req, res, next) => {
    const proxy = matchProxy(req.url);
    if (proxy) {
      forward(proxy, req, res);
      return;
    }
    return metroMiddleware(req, res, next);
  },
};

module.exports = config;
