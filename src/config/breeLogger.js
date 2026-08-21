import winston from 'winston'
import 'winston-daily-rotate-file'

const { combine, timestamp, printf } = winston.format
const logFormat = printf(({ timestamp, level, message }) => {
    return `[${timestamp}] [${level.toUpperCase()}] ${message}`
})

const breeLogger = winston.createLogger({
    level: 'info',
    format: combine(
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        logFormat
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.DailyRotateFile({
            dirname: 'logs',
            filename: 'worker-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            maxSize: '20m',
            maxFiles: '30d'
        })
    ]
})

/**
 * worker日志
 */
const worker = (jobName, message) => {
    breeLogger.info(`[${jobName}] ${message}`)
}

/**
 * error日志
 */
const error = (jobName, err) => {
    breeLogger.error(`[${jobName}] ${err?.stack || err?.message || err}`)
}

export { worker, error }
export default { worker, error }