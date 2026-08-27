import { parentPort, workerData } from 'node:worker_threads'
import createLogger from '../config/createLogger.js'
import redis from '../utils/redisUtil.js'
import { useDatabase } from '../utils/databaseUtil.js'

export function useHandler() {
    let isCancelled = false
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
        if (typeof worker !== 'function') {
            logger.error(`run worker is not a function`)
            return
        }

        let close = null
        try {
            const database = await useDatabase()
            const db = database.db
            close = database.close
            const result = await worker({ logger, redis, db, workerData })
            if (parentPort) parentPort.postMessage({ type: 'complete', data: result })
        }
        catch (error) {
            logger.error(`worker=>${error?.stack || error?.message || error}`)
        }
        finally {
            try {
                await close?.()
            } catch (error) {
                logger.error(`database close=>${error?.stack || error?.message || error}`)
            }
            if (parentPort) parentPort.postMessage('done')
            else process.exit(0)
        }
    }

    return { run, getIsCancelled }
}
