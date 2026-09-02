import { getRedis, closeRedis } from '../core/redis.js'

class RedisHelper {
    async set(key, value, expireSeconds = null) {
        const redis = await getRedis()

        const data =
            typeof value === 'object'
                ? JSON.stringify(value)
                : String(value)

        if (expireSeconds) {
            return await redis.set(key, data, {
                EX: expireSeconds
            })
        }

        return await redis.set(key, data)
    }

    async get(key) {
        const redis = await getRedis()

        const value = await redis.get(key)

        if (!value) return null

        try {
            return JSON.parse(value)
        } catch {
            return value
        }
    }

    async del(key) {
        const redis = await getRedis()
        return await redis.del(key)
    }

    async exists(key) {
        const redis = await getRedis()
        return (await redis.exists(key)) === 1
    }

    async expire(key, seconds) {
        const redis = await getRedis()
        return await redis.expire(key, seconds)
    }

    async ttl(key) {
        const redis = await getRedis()
        return await redis.ttl(key)
    }

    async incr(key) {
        const redis = await getRedis()
        return await redis.incr(key)
    }

    async decr(key) {
        const redis = await getRedis()
        return await redis.decr(key)
    }

    async hSet(key, field, value) {
        const redis = await getRedis()

        return await redis.hSet(
            key,
            field,
            typeof value === 'object'
                ? JSON.stringify(value)
                : String(value)
        )
    }

    async hGet(key, field) {
        const redis = await getRedis()

        const value = await redis.hGet(key, field)

        if (!value) return null

        try {
            return JSON.parse(value)
        } catch {
            return value
        }
    }

    async hGetAll(key) {
        const redis = await getRedis()
        return await redis.hGetAll(key)
    }

    async lPush(key, value) {
        if (value === null || value === undefined)
            return null

        value = typeof value === 'object' ? JSON.stringify(value) : String(value)
        const redis = await getRedis()
        return redis.lPush(key, value)
    }

    async rPush(key, value) {
        if (value === null || value === undefined)
            return null

        value = typeof value === 'object' ? JSON.stringify(value) : String(value)
        const redis = await getRedis()
        return redis.rPush(key, value)
    }

    async rPop(key, json = false) {
        const redis = await getRedis()
        const value = await redis.rPop(key)
        if (!value) return null
        if (json) {
            try {
                return JSON.parse(value)
            } catch {
                return value
            }
        }
        return value
    }

    async lPop(key, json = false) {
        const redis = await getRedis()
        const value = await redis.lPop(key)
        if (!value) return null
        if (json) {
            try {
                return JSON.parse(value)
            } catch {
                return value
            }
        }
        return value
    }

    async close() {
        await closeRedis()
    }
}

export default new RedisHelper()