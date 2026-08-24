import { parentPort, workerData } from 'node:worker_threads'
import createLogger from '../config/createLogger.js'
import redis from '../utils/redisUtil.js'
import database from '../utils/databaseUtil.js'

/**
 * handler（最初的 handler，独立文件版，自包含，不依赖 hooks）
 *
 * 引用者通过单次注入 updateTask 钩子配置任务状态回写：
 *   import { handler } from '@layoutkit/bree-core'
 *
 *   const { run } = handler({
 *       updateTask: async (id, patch) => {
 *           // id:   当前任务 ID
 *           // patch: 成功 { ResultStatus: 0, ExecuteResult } / 失败 { ResultStatus: 1, ErrorMessage }
 *           await myDb('My_Jobs').where('ID', id).update(patch)
 *       }
 *   })
 *
 *   await run(async ({ logger, redis, db }) => {
 *       return result  // 成功自动回写 { ResultStatus: 0, ExecuteResult: result }
 *       // 抛错自动回写 { ResultStatus: 1, ErrorMessage: err.message }
 *   })
 *
 * 未配置钩子时不执行回写。
 *
 * @param {object} [options]
 * @param {function} [options.updateTask] 钩子函数 async (id, patch) => *，更新任务状态
 */
export function handler({ updateTask: customUpdateTask = null } = {}) {
    let isCancelled = false
    let db = null
    let dbOwned = false
    const logger = createLogger({ name: workerData?.name || 'worker' })

    const getIsCancelled = () => isCancelled

    // 更新任务状态：引用者注入的 updateTask 钩子
    const updateTask = async (obj) => {
        const id = workerData?.id
        if (customUpdateTask) return await customUpdateTask(id, obj)
        // 未配置钩子：不执行回写
    }

    const run = async (worker) => {
        if (parentPort)
            parentPort.once('message', (message) => {
                console.log(message)
                if (message === 'cancel') isCancelled = true
            })

        if (!customUpdateTask && !db) {
            db = await database.init()
            dbOwned = true
        }

        try {
            const result = await worker({ logger, redis, db })
            await updateTask({ 'ResultStatus': 0, 'ExecuteResult': result })
        } catch (err) {
            await updateTask({ 'ResultStatus': 1, 'ErrorMessage': err.message })
            logger.error(`${err?.stack || err?.message || err}`)
        } finally {
            await redis.close()
            if (dbOwned) await database.close() // 关闭连接池
            if (parentPort) {
                parentPort.postMessage('done')
            } else {
                process.exit(0)
            }
        }
    }

    return { run, getIsCancelled }
}
