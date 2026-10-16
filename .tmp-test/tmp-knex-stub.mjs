export const records = []

export default function knex(config) {
    const record = { pool: config.pool, destroyed: false, prewarm: 0 }
    records.push(record)

    return {
        config,
        async raw() {
            record.prewarm += 1
            return [[1]]
        },
        async destroy() {
            record.destroyed = true
        }
    }
}
