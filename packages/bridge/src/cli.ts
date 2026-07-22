import { startBridgeDefault } from './bootstrap.js'

const PORT = Number(process.env.CSB_BRIDGE_PORT ?? 4319)

const bridge = startBridgeDefault(PORT)

const shutdown = () => { bridge.close(); process.exit(0) }
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
