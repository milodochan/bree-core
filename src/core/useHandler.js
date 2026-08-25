import { parentPort } from 'node:worker_threads'
import createLogger from '../config/createLogger.js'
import redis from '../utils/redisUtil.js'
import database from '../utils/databaseUtil.js'

export function useHandler() {
    let isCancelled = false
    let db = null
    const logger = createLogger({ name: 'worker' })

    if (parentPort)
        parentPort.once('message', (message) => {
            if (message !== 'cancel') return

            isCancelled = true
            if (parentPort) parentPort.postMessage('cancelled')
            else process.exit(0)
        })

    const getIsCancelled = () => isCancelled
    const run = async (worker) => {
        db = await database.init()
        const result = await worker({ logger, redis, db })
        if (parentPort) {
            parentPort.postMessage({
                type: 'done',
                data: result
            })
        }
        else process.exit(0)
    }

    return { run, getIsCancelled }
}
