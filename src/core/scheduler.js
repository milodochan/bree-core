import Bree from 'bree'
import path from 'node:path'
import fs from 'node:fs'
import createLogger from '../config/createLogger.js'
import database from '../utils/databaseUtil.js'
import hooks from './hooks.js'

let bree = null
let db = null
let jobsRoot = null

const logger = createLogger({ name: 'scheduler', split: true })

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

const createBree = () => {
    const jobsPath = getJobsRoot()
    // 确保 jobs 目录存在（创建警告但不自动创建，因为这是使用者的责任）
    if (!fs.existsSync(jobsPath)) {
        console.warn(`⚠️  Jobs directory not found: ${jobsPath}`)
        console.warn(`   Please create it or set BREE_JOBS_PATH environment variable`)
    }
    const instance = new Bree({
        hasSeconds: true,
        root: jobsPath,
        doRootCheck: false, // 任务列表由 hooks.registerLoader / 数据库提供，无需 root/index.js
        errorHandler: async (error, workerMetadata) => {
            if (error?.message?.indexOf('exited with code') > -1) return
            const name = workerMetadata?.name
            logger.info(`[${name}] There was an error while running a worker ${name} with thread ID: ${workerMetadata?.threadId}`)
            logger.error(`[${name}] ${error?.stack || error?.message || error}`)
            const worker = instance.workers.get(name)
            const workerData = worker?.workerData
            if (workerData) {
                await hooks.registerError(db, { id: workerData.id, error: error?.stack })
            }
        }
    })

    instance.on('worker created', (name) => {
        console.log(`[${name}] worker created`)
        logger.info(`[${name}] worker created`)
    })

    instance.on('worker deleted', async (name) => {
        console.log(`[${name}] worker deleted`)
        logger.info(`[${name}] worker deleted`)
    })

    instance.on('worker message', async (name, message) => {
        console.log(`[${name}] worker message:`, message)

        if (message.type === 'done') {
            try {
                const worker = instance.workers.get(name)
                const workerData = worker?.workerData
                await hooks.registerComplete(db, {
                    id: workerData?.id,
                    result: message.data
                })
            } catch (error) {
                logger.error(`[${name}] registerComplete failed`, error)
            }
        }
    })

    return instance
}

const getBree = () => bree
const reset = async (job, startStatus) => {
    await bree.stop(job.name)
    const index = bree.config.jobs.findIndex(x => x.name === job.name)
    if (index !== -1) bree.config.jobs.splice(index, 1)
    await bree.add(job)
    if (startStatus) await bree.start(job.name)
}

const remove = async (name) => {
    await bree.stop(name)
    // 删除运行中的 worker 貌似不需要
    // delete bree.workers.get(name)
    const index = bree.config.jobs.findIndex(x => x.name === name)
    if (index !== -1) bree.config.jobs.splice(index, 1)
}

const create = async (job) => {
    if (bree.config.jobs.some(x => x.name === job.name))
        return

    await bree.add(job)
}

// 启动任务
const start = async (name) => await bree.start(name)
// 停止任务
const stop = async (name) => await bree.stop(name)
// 执行一次任务
const run = async (name) => await bree.run(name)
// 任务初始化
const register = async () => {
    db = await database.init()
    bree = createBree()
    await hooks.registerLoader(db, logger)
}

export default {
    register,
    create,
    reset,
    start,
    stop,
    run,
    getBree,
    remove
}