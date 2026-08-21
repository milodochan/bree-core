import winston from 'winston'
import 'winston-daily-rotate-file'

const { combine, timestamp, printf } = winston.format
const logFormat = printf(({ timestamp, level, message }) => {
    return `[${timestamp}] [${level.toUpperCase()}] ${message}`
})

/**
 * 日志级别过滤器
 */
const levelFilter = (level) => {
    return winston.format((info) => {
        return info.level === level ? info : false
    })()
}

const logger = winston.createLogger({
    level: 'info',
    format: combine(
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        logFormat
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.DailyRotateFile({
            dirname: 'logs',
            filename: 'info-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            maxSize: '20m',
            maxFiles: '30d',
            format: combine(
                levelFilter('info'),
                timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
                logFormat
            )
        }),
        new winston.transports.DailyRotateFile({
            dirname: 'logs',
            filename: 'error-%DATE%.log',
            level: 'error',
            datePattern: 'YYYY-MM-DD',
            maxSize: '20m',
            maxFiles: '30d',
            format: combine(
                levelFilter('error'),
                timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
                logFormat
            )
        })
    ]
})

export default logger