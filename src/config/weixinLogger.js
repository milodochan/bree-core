import winston from 'winston'
import 'winston-daily-rotate-file'

const { combine, timestamp, printf } = winston.format
const logFormat = printf(({ timestamp, level, message }) => {
    return `[${timestamp}] [${level.toUpperCase()}] ${message}`
})

const weixinLogger = winston.createLogger({
    level: 'info',
    format: combine(
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        logFormat
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.DailyRotateFile({
            dirname: 'logs',
            filename: 'weixinapi-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            maxSize: '20m',
            maxFiles: '30d'
        })
    ]
})

/**
 * worker日志
 */
const info = (apiName, message) => {
    weixinLogger.info(`[${apiName}] ${message}`)
}

/**
 * error日志
 */
const error = (apiName, err) => {
    weixinLogger.error(`[${apiName}] ${err?.stack || err?.message || err}`)
}

export { info, error }
export default { info, error }