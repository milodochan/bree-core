import { createLogger } from './createLogger.js'

// 可以删除 使用的地方自己写
const weixinLogger = createLogger({
    name: 'weixinapi'
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
