import Bree from 'bree'
import path from 'node:path'
import fs from 'node:fs'
import { __dirname } from './utils/path.js'
import blogger from './config/breeLogger.js'
import database from './utils/databaseUtil.js'

const projectRoot = path.resolve(__dirname, '../../')

let bree = null
let db = null
let jobsRoot = null

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
        errorHandler: async (error, workerMetadata) => {
            if (workerMetadata?.threadId) {
                blogger.worker(workerMetadata.name,
                    `There was an error while running a worker ${workerMetadata.name} with thread ID: ${workerMetadata.threadId}`)
            } else {
                blogger.worker(workerMetadata.name,
                    `There was an error while running a worker ${workerMetadata.name}`)
            }

            blogger.error(workerMetadata?.name, error)
            if (error?.message?.indexOf('exited with code') > -1) return
            const job = instance.config.jobs.find(x => x.name === workerMetadata?.name)
            const workerData = job?.worker?.workerData
            if (workerData) {
                await db('Sys_BreeJobs')
                    .where('ID', workerData.id)
                    .update({
                        'ResultStatus': 1,
                        'ErrorMessage': error?.stack
                    })
            }
        }
    })

    instance.on('worker created', (name) => {
        console.log('worker created', name)
        blogger.worker(name, 'worker created')
    })

    instance.on('worker deleted', (name) => {
        console.log('worker deleted', name)
        blogger.worker(name, 'worker deleted')
    })

    return instance
}

const getBree = () => {
    return bree
}

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
const start = async (name) => {
    await bree.start(name)
}
// 停止任务
const stop = async (name) => {
    await bree.stop(name)
}
// 执行一次任务
const run = async (name) => {
    await bree.run(name)
}

// 任务初始化
const init = async () => {
    // 1. 从数据库读取任务列表
    db = await database.init()
    // 2. 创建 Bree 实例（在数据库初始化之后）
    bree = createBree()
    // 3. 从数据库读取任务列表
    const jobs = await db('Sys_BreeJobs') //.where('Status', 1)
    // 4. 批量注册到调度器
    for (const job of jobs) {
        const id = job['ID']
        const name = job['Name']
        const cron = job['Cron']
        const path = job['Path']
        const status = job['Status'] // status 状态为0：已停止 1：执行中 2：
        const createStatus = job['CreateStatus']

        try {
            await create({
                name,
                cron,
                path: path || undefined,
                worker: { workerData: { id } }
            })

            if (status === 1) await bree.start(name)
            if (createStatus === 0) {
                await db('Sys_BreeJobs')
                    .where('ID', id)
                    .update({
                        'CreateStatus': 1
                    })
            }
        }
        catch (error) {
            blogger.error(name, error)
            await db('Sys_BreeJobs')
                .where('ID', id)
                .update({
                    'ResultStatus': 1,
                    'ErrorMessage': error?.stack
                })
        }
    }
}

export default {
    init,
    create,
    reset,
    start,
    stop,
    run,
    getBree,
    remove
}