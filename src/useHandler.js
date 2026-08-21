import { parentPort, workerData } from 'node:worker_threads'
import logger from './config/logger.js'
import redis from './utils/redisUtil.js'
import database from './utils/databaseUtil.js'

export function useHandler() {
    let isCancelled = false
    let db = null

    const getIsCancelled = () => isCancelled
    const updateTask = async (obj) => {
        await db('Sys_BreeJobs')
            .where('ID', workerData.id)
            .update(obj)
    }
    const run = async (worker) => {
        if (parentPort)
            parentPort.once('message', (message) => {
                console.log(message)
                if (message === 'cancel') isCancelled = true
            })

        db = await database.init()

        try {
            const result = await worker({ logger, redis, db })
            await updateTask({ 'ResultStatus': 0, 'ExecuteResult': result })
        } catch (err) {
            await updateTask({ 'ResultStatus': 1, 'ErrorMessage': err.message })
            logger.error(`${err?.stack || err?.message || err}`)
        } finally {
            await redis.close()
            await database.close() // 关闭连接池
            if (parentPort) {
                parentPort.postMessage("done")
            } else {
                process.exit(0)
            }
        }
    }

    return { run, getIsCancelled }
}
