// bufferutil + utf-8-validate are OPTIONAL native perf addons for ws (pulled in by both ws and
// ccxt). We don't need them - ws falls back to a pure-JS implementation, and we only use ccxt's
// REST ticker, not its websockets. They force a node-gyp COMPILE that breaks here (no prebuilt for
// Electron's ABI, a space in the project path, and Python 3.12 dropped distutils). @electron/rebuild
// scans the whole pnpm store, so the only reliable fix is to keep them out of the store entirely.
const DROP = ['bufferutil', 'utf-8-validate']

function readPackage(pkg) {
  for (const name of DROP) {
    if (pkg.dependencies) delete pkg.dependencies[name]
    if (pkg.optionalDependencies) delete pkg.optionalDependencies[name]
  }
  return pkg
}

module.exports = { hooks: { readPackage } }
