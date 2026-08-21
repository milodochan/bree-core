import { createClient } from 'redis'

let client = null
let isConnected = false

async function createRedisClient() {
    const redis = createClient({
        socket: {
            host: process.env.REDIS_HOST,
            port: Number(process.env.REDIS_PORT),
            reconnectStrategy(retries) {
                console.log(`Redis 重连 ${retries}`)

                // 超过 2 次停止重连
                if (retries > 3) {
                    return new Error('Redis 重连失败')
                }

                return Math.min(retries * 1000, 5000)
            }
        },
        RESP: 2,   // ⭐关键
        username: process.env.REDIS_USERNAME || undefined,
        password: process.env.REDIS_PASSWORD || undefined,
        database: Number(process.env.REDIS_DB || 0)
    })

    redis.on('connect', () => {
        console.log('Redis 正在连接...')
    })

    redis.on('ready', () => {
        isConnected = true
        console.log('Redis 已连接')
    })

    redis.on('reconnecting', () => {
        console.log('Redis 重连中...')
    })

    redis.on('end', () => {
        isConnected = false
        console.log('Redis 已断开')
    })

    redis.on('error', (err) => {
        console.error('Redis异常:', err.message)
    })

    await redis.connect()

    return redis
}

export async function getRedis() {
    if (!client) {
        client = await createRedisClient()
    }

    return client
}

export function redisConnected() {
    return isConnected
}

export async function closeRedis() {
    if (client) {
        await client.quit()
        client = null
    }
}