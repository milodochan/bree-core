import winston from 'winston'
import 'winston-daily-rotate-file'
import path from 'node:path'
import { parentPort, isMainThread } from 'node:worker_threads'

const { combine, timestamp, printf } = winston.format

/**
 * 默认日志格式：可被 format 参数覆盖
 */
const defaultLogFormat = printf(({ timestamp, level, message }) => {
    return `[${timestamp}] [${level.toUpperCase()}] ${message}`
})

/**
 * 单级别文件过滤器（用于 split 按级别拆文件）
 */
const levelFilter = (level) => {
    return winston.format((info) => {
        return info.level === level ? info : false
    })()
}

/**
 * split=true 时默认按全部级别拆分
 */
const defaultSplitLevels = ['debug', 'info', 'warn', 'error']

/**
 * worker 线程内的日志代理：不直接写文件，而是把日志 postMessage 给主线程，
 * 由主线程按 name 分流到对应的独立文件（见 scheduler.workerLogHandler）。
 *
 * 这样在 worker 中调用 createLogger({ name: 'weixinapi' }) 也能落到 logs/weixinapi/ 独立文件，
 * 而不会在每个 worker 里各自开一份文件句柄（多 worker 写同一文件 / 句柄泄漏）。
 * 参数序列化与 workerLogger.js 保持一致：
 *   - Error -> { message, stack }（保证能通过 postMessage 且主线程能还原成 stack）
 *   - 不可结构化克隆的对象 -> String(arg)
 *
 * @param {string} name  logger 名，作为主线程分流 / 独立子目录的依据
 */
const createWorkerProxy = (name) => {
    const proxy = {}
    for (const level of ['debug', 'info', 'warn', 'error']) {
        proxy[level] = (...args) => {
            parentPort?.postMessage({
                type: 'log',
                name,
                level,
                args: args.map(arg => {
                    if (arg instanceof Error) {
                        return { message: arg.message, stack: arg.stack }
                    }
                    try {
                        structuredClone(arg)
                        return arg
                    } catch {
                        return String(arg)
                    }
                })
            })
        }
    }
    proxy.close = () => { }
    return proxy
}

/**
 * 统一 logger 工厂
 * @param {object} options
 * @param {string} [options.name='app']        日志文件名前缀，如 'worker' -> worker-%DATE%.log；不传 dirname 时同时作为子目录名
 * @param {string} [options.dirname]           日志子目录（相对 logs 根）；不传则用 name 作为子目录名，
 *                                             显式传 '' 则直接写在 logs 根下。如 'weixinapi' -> logs/weixinapi/
 * @param {string} [options.level='info']      日志级别：error | warn | info | debug
 * @param {function} [options.format]          自定义日志格式（printf 函数），默认 [时间] [级别] 消息
 * @param {boolean} [options.console=true]     是否输出到控制台
 * @param {boolean} [options.file=true]        是否输出到文件
 * @param {string} [options.datePattern='YYYY-MM-DD']  日志文件名日期格式
 * @param {string} [options.maxSize='20m']     单个日志文件大小上限，超过即滚动，如 '20m' | '100k'
 * @param {string|number} [options.maxFiles='30d']  日志保留时长/份数，如 '30d' | 14
 * @param {boolean|string[]} [options.split=false]
 *        false：不拆分，全部写到 <name>-%DATE%.log
 *        true：按 debug/info/warn/error 各写一个文件
 *        数组：按传入级别拆分，如 ['info', 'warn', 'error']
 * @returns {import('winston').Logger}
 */
export function createLogger(options = {}) {
    const { name = 'app' } = options

    // —— worker 线程：返回代理，由主线程按 name 分流到独立文件 ——
    // 避免在多个 worker 中各开文件句柄；同时支持任意 name 落到独立目录
    // （如 worker 内的业务 logger createLogger({ name: 'weixinapi' }) -> logs/weixinapi/）。
    if (!isMainThread) {
        return createWorkerProxy(name)
    }

    const {
        dirname,
        level = 'info',
        format = defaultLogFormat,
        console = true,
        file = true,
        datePattern = 'YYYY-MM-DD',
        maxSize = '10m',
        maxFiles = '10d',
        split = false
    } = options

    // 目录解析：设置 LOG_DIR 环境变量即自动以其为日志根目录，否则以 logs 为根目录
    // dirname 为其下子目录；不传 dirname 时自动用 name 作为子目录；显式传 '' 则直接写根
    const subDir = dirname ?? name
    const root = process.env.LOG_DIR ? path.join(process.env.LOG_DIR, 'logs') : 'logs'
    const logDir = path.join(root, subDir)

    /**
     * 内部：创建文件滚动 transport
     * @param {string} filename
     * @param {string} [fileLevel] 指定级别时配合 levelFilter 精确过滤，仅写该级别日志
     */
    const createFileTransport = (filename, fileLevel) => {
        const formatParts = [
            timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            format
        ]
        if (fileLevel) formatParts.unshift(levelFilter(fileLevel))

        return new winston.transports.DailyRotateFile({
            dirname: logDir,
            filename,
            ...(fileLevel ? { level: fileLevel } : {}),
            datePattern,
            maxSize,
            maxFiles,
            format: combine(...formatParts)
        })
    }

    const transports = []

    if (console)
        transports.push(new winston.transports.Console())

    if (file) {
        const splitLevels = split ? defaultSplitLevels : null
        if (splitLevels) {
            for (const splitLevel of splitLevels) {
                transports.push(createFileTransport(`${name}-${splitLevel}-%DATE%.log`, splitLevel))
            }
        } else {
            transports.push(createFileTransport(`${name}-%DATE%.log`))
        }
    }

    const logger = winston.createLogger({
        level,
        format: combine(
            timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            format
        ),
        transports
    })

    // 手动挂载一个安全的 close 方法
    logger.close = function () {
        if (this.transports) {
            for (const t of this.transports) {
                if (typeof t.close === 'function') t.close()
            }
        }
    }

    return logger
}

export default createLogger
