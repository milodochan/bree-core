import { parentPort, workerData } from 'node:worker_threads'
import createLogger from '../config/createLogger.js'
import redis from '../utils/redisUtil.js'
import { useDatabase } from '../utils/databaseUtil.js'

export function useHandler() {
    let isCancelled = false
    let enableDb = true

    if (parentPort)
        parentPort.once('message', (message) => {
            if (message !== 'cancel') return

            isCancelled = true
            if (parentPort) parentPort.postMessage('cancelled')
            else process.exit(0)
        })

    const getIsCancelled = () => isCancelled
    const disabledDb = () => enableDb = false
    const run = async (worker) => {
        let logger = createLogger({ name: 'worker' })
        if (typeof worker !== 'function') {
            logger.error(`run worker is not a function`)
            return
        }

        let db = null
        let close = null
        let result
        let workerError = null
        try {
            if (enableDb) {
                const database = await useDatabase()
                db = database.db
                close = database.close
            }
            result = await worker({ logger, redis, db, requestData: workerData?.requestData })
        }
        catch (error) {
            workerError = error   // 先保存，避免被 finally 覆盖
        }
        finally {
            try {
                if (enableDb) {
                    await Promise.race([
                        close?.(),
                        new Promise((_, reject) =>
                            setTimeout(() => reject(new Error('close timeout')), 5000)
                        )
                    ])
                }
            } catch (e) {
                logger.error(`close[database]=>${e?.message || e}`)
            }
            try {
                await redis.close()
            } catch (error) {
                logger.error(`close[redis]=>${error?.stack || error?.message || error}`)
            }

            db = null
            close = null
        }

        if (workerError) {
            // if (parentPort) parentPort.postMessage({ type: 'error', data: workerError.stack || workerError.message || workerError })
            result = null
            logger = null
            throw workerError
        }

        if (parentPort) {
            parentPort.postMessage({ type: 'complete', data: result })
            result = null
            logger = null
            parentPort.postMessage('done')
        }
        else process.exit(0)
    }

    return { run, getIsCancelled, disabledDb }
}
