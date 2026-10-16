import Bree from 'bree'
import path from 'node:path'
import fs from 'node:fs'
import createLogger from '../config/createLogger.js'
import { useDatabase } from '../utils/databaseUtil.js'
import hooks from './hooks.js'

let db = null
let close = null
let bree = null
let jobsRoot = null

const logger = createLogger({ name: 'scheduler' })

// worker 日志按 logger 名分流到独立文件（真实文件 logger 只在主线程持有，避免 worker 各自开句柄）
// 例如：worker 内 createLogger({ name: 'weixinapi' }) 的日志 -> logs/weixinapi/
//       未带 name 的通用 worker 日志 -> logs/worker/
const forwardLoggers = new Map()
const getForwardLogger = (name = 'worker') => {
    if (!forwardLoggers.has(name))
        forwardLoggers.set(name, createLogger({ name }))
    return forwardLoggers.get(name)
}

// 让使用者通过环境变量或配置指定 jobs 目录
const getJobsRoot = () => {
    if (jobsRoot) return jobsRoot

    // 多种方式获取 jobs 目录
    // 1. 环境变量
    if (process.env.BREE_JOBS_PATH) {
        jobsRoot = path.resolve(process.env.BREE_JOBS_PATH)
        return jobsRoot
    }

    // 2. 使用当前工作目录（项目根目录）
    const cwd = process.cwd()
    const possiblePaths = [
        path.join(cwd, 'src/jobs'),
        path.join(cwd, 'jobs'),
        path.join(cwd, 'dist/jobs'),
    ]

    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            jobsRoot = p
            return jobsRoot
        }
    }

    // 3. 默认使用当前工作目录下的 src/jobs
    jobsRoot = path.join(cwd, 'src/jobs')
    console.warn(`Jobs directory not found, using default: ${jobsRoot}`)
    return jobsRoot
}

const workerLogHandler = (name, message) => {
    if (message?.type !== 'log') return

    try {
        // 按 logger 名分流：weixinapi -> logs/weixinapi/；未命名 -> logs/worker/
        const target = getForwardLogger(message.name)
        const output = target[message.level] ?? target.info
        const parts = [`[${name}]`].concat(message.args ?? [])
        const text = parts.map(arg => {
            if (arg && typeof arg === 'object' && typeof arg.stack === 'string' && typeof arg.message === 'string')
                return arg.stack                              // worker 代理已把 Error 转成 {message,stack}
            if (arg && typeof arg === 'object')
                return JSON.stringify(arg)
            return arg
        }).join(' ')
        output.call(target, text)
    }
    catch (error) {
        getForwardLogger('worker').error(`[${name}] ${error?.stack || error?.message || error}`)
    }
}

const workerCompleteHanlder = async (name, message, workerData) => {
    try {
        if (message?.type !== 'complete') return

        if (hooks.registerComplete === null || typeof hooks.registerComplete !== 'function') {
            logger.error('hooks.registerComplete is not a function')
            return
        }

        if (!db) {
            logger.error('Database initialization failed')
            return
        }

        const sendData = { ...workerData, result: JSON.stringify(message?.data ?? {}) }
        await hooks.registerComplete(db, sendData)
    }
    catch (error) {
        logger.error(`[${name}] ${error?.stack || error?.message || error}`)
    }
}

const errorHandler = async (name, error, workerData) => {
    try {
        if (error?.message?.indexOf('exited with code') > -1) return
        logger.error(`[${name}] ${error?.stack || error?.message || error}`)

        if (hooks.registerError === null || typeof hooks.registerError !== 'function') {
            logger.error('hooks.registerError is not a function')
            return
        }

        if (!db) {
            logger.error('Database initialization failed')
            return
        }

        const sendData = {
            ...workerData,
            error: error?.stack ||
                error?.message
        }
        await hooks.registerError(db, sendData)
        // await bree.stop(name)
    }
    catch (error) {
        logger.error(`[${name}] ${error?.stack || error?.message || error}`)
    }
}

const createBree = () => {
    const jobsPath = getJobsRoot()
    // 确保 jobs 目录存在（创建警告但不自动创建，因为这是使用者的责任）
    if (!fs.existsSync(jobsPath)) {
        console.warn(`⚠️  Jobs directory not found: ${jobsPath}`)
        console.warn(`   Please create it or set BREE_JOBS_PATH environment variable`)
    }
    const getWorkerData = (name) => instance.config.jobs.find(a => a.name === name)?.worker?.workerData
    const instance = new Bree({
        hasSeconds: true,
        root: jobsPath,
        doRootCheck: false, // 任务列表由 hooks.registerLoader / 数据库提供，无需 root/index.js
        // bree 9.x 官方消息回调（替代已移除的 'worker message' 事件）：
        // worker 发来的所有消息都进这里；发字符串 'done' 时 bree 会自动清理 worker（terminate + worker deleted）
        workerMessageHandler: async (workerMetadata) => {
            const name = workerMetadata?.name
            const message = workerMetadata?.message

            workerLogHandler(name, message)

            const workerData = getWorkerData(name)
            if (!workerData) return
            await workerCompleteHanlder(name, message, workerData)
        },
        errorHandler: async (error, workerMetadata) => {
            const name = workerMetadata?.name

            const workerData = getWorkerData(name)
            if (!workerData) return
            await errorHandler(name, error, workerData)
        }
    })

    instance.on('worker created', (name) => {
        // console.log(`[${name}] worker created`)
        logger.info(`[${name}] worker created`)
    })

    instance.on('worker deleted', async (name) => {
        // console.log(`[${name}] worker deleted`)
        logger.info(`[${name}] worker deleted`)
    })

    return instance
}

// 统一返回结构：
//   成功: { code: 0, message, data }
//   失败: { code: -1, message }
const ok = (message, data = undefined) => ({ code: 0, message, data })
const fail = (message) => ({ code: -1, message })
const notInit = () => (bree ? null : fail('scheduler 未初始化，请先调用 scheduler.register()'))
const isExist = (name) => bree?.config?.jobs?.some(x => x.name === name)

// 统一包装：未初始化检查 + 异常捕获，让每个方法只保留业务逻辑
const guard = (fn) => async (...args) => {
    const ni = notInit()
    if (ni) return ni

    try {
        return await fn(...args)
    }
    catch (e) {
        return fail(e?.message || String(e))
    }
}

const getBree = () => bree

// 创建任务（仅注册到调度器，不会自动执行）
const create = guard(async (job) => {
    const { name, cron, path, workerData, requestData } = job
    if (!name) return fail('job 必须包含 name')
    if (isExist(name)) return fail(`job "${name}" 已存在`)
    await bree.add({
        name,
        cron,
        path: path || undefined,
        worker: {
            workerData: {
                ...workerData,
                requestData
            }
        }
    })
    return ok(`job "${name}" 创建成功`, { name })
})

// 重置任务（移除后按新配置重新添加，可选立即启动）
const reset = guard(async (job) => {
    const { name, cron, path, workerData, requestData, status } = job
    if (!name) return fail('job 必须包含 name')
    await remove(name)
    await bree.add({
        name,
        cron,
        path: path || undefined,
        worker: {
            workerData: {
                ...workerData,
                requestData
            }
        }
    })
    if (status) await bree.start(name)
    return ok(`job "${name}" 已重置${status ? '并启动' : ''}`, { name, status })
})

// 移除任务（停止并删除）
const remove = guard(async (name) => {
    if (!isExist(name)) return fail(`job "${name}" 不存在`)
    await bree.stop(name)
    const index = bree.config.jobs.findIndex(x => x.name === name)
    if (index !== -1) bree.config.jobs.splice(index, 1)
    return ok(`job "${name}" 已移除`, { name })
})

// 启动任务
const start = guard(async (name) => {
    if (!isExist(name)) return fail(`job "${name}" 不存在`)
    await bree.start(name)
    return ok(`job "${name}" 已启动`, { name })
})

// 停止任务
const stop = guard(async (name) => {
    if (!isExist(name)) return fail(`job "${name}" 不存在`)
    await bree.stop(name)
    return ok(`job "${name}" 已停止`, { name })
})

// 执行一次任务（不按周期调度，立即跑一次）
const run = guard(async (name) => {
    if (!isExist(name)) return fail(`job "${name}" 不存在`)
    await bree.run(name)
    return ok(`job "${name}" 已触发执行`, { name })
})

// 任务初始化：初始化数据库、创建 Bree 实例并加载任务列表
const register = async () => {
    try {
        if (hooks.registerLoader === null || typeof hooks.registerLoader !== 'function')
            throw new Error('hooks.registerLoader is not a function')

        const database = await useDatabase()
        db = database.db
        if (!db) throw new Error('Database initialization failed')

        close = database.close
        bree = createBree()
        if (!bree) throw new Error('Breejs initialization failed')

        await hooks.registerLoader(db, logger)
        const jobs = bree.config.jobs.map(x => ({ name: x.name, interval: x.interval }))
        return ok('scheduler 已注册', { jobs })
    }
    catch (error) {
        logger.error(`register=>${error?.stack || error?.message || error}`)
    }
}

const clear = async () => {
    await close?.()
    bree = null
    jobsRoot = null
}

export default {
    register,
    create,
    reset,
    start,
    stop,
    run,
    getBree,
    remove,
    clear
}