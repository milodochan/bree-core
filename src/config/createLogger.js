import winston from 'winston'
import 'winston-daily-rotate-file'
import path from 'node:path'

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
 * 统一 logger 工厂
 * @param {object} options
 * @param {string} [options.name='app']        日志文件名前缀，如 'worker' -> worker-%DATE%.log
 * @param {string} [options.dirname='logs']    日志输出目录（相对 cwd）
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
    const {
        name = 'app',
        dirname = 'logs',
        level = 'info',
        format = defaultLogFormat,
        console = true,
        file = true,
        datePattern = 'YYYY-MM-DD',
        maxSize = '20m',
        maxFiles = '30d',
        split = false,
        envDir = false
    } = options

    // 目录解析：启用环境变量时以 process.env.LOG_DIR 为根目录拼接 dirname
    let logDir = dirname
    if (envDir) {
        const envRoot = process.env.LOG_DIR
        if (envRoot) {
            logDir = path.join(envRoot, dirname)
        } else {
            console.warn(`[createLogger] 环境变量 LOG_DIR 未设置，回退到相对目录: ${dirname}`)
        }
    }

    // 所有文件 transport，用于日志路径查询
    const fileTransports = []

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

    if (console) {
        transports.push(new winston.transports.Console())
    }

    if (file) {
        const splitLevels = Array.isArray(split)
            ? split
            : (split ? defaultSplitLevels : null)

        if (splitLevels) {
            for (const splitLevel of splitLevels) {
                transports.push(createFileTransport(`${name}-${splitLevel}-%DATE%.log`, splitLevel))
            }
        } else {
            transports.push(createFileTransport(`${name}-%DATE%.log`))
        }
    }

    return winston.createLogger({
        level,
        format: combine(
            timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            format
        ),
        transports
    })
}

export default createLogger
