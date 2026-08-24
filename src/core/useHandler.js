import { parentPort, workerData } from 'node:worker_threads'
import createLogger from '../config/createLogger.js'
import redis from '../utils/redisUtil.js'
import database from '../utils/databaseUtil.js'
import hooks from './hooks.js'

export function useHandler() {
    let isCancelled = false
    let db = null
    const logger = createLogger({ name: workerData?.name || 'worker' })

    const getIsCancelled = () => isCancelled
    const run = async (worker) => {
        if (parentPort)
            parentPort.once('message', (message) => {
                console.log(message)
                if (message === 'cancel') isCancelled = true
            })

        db = await database.init()

        try {
            const result = await worker({ logger, redis, db })
            await hooks.registerComplete(db, { id: workerData?.id, result: result })
        } catch (err) {
            const message = `${err?.stack || err?.message || err}`
            await hooks.registerError(db, { id: workerData?.id, error: message })
            logger.error(message)
        } finally {
            await redis.close()
            await database.close() // 关闭连接池
            if (parentPort) {
                parentPort.postMessage('done')
            } else {
                process.exit(0)
            }
        }
    }

    return { run, getIsCancelled }
}
