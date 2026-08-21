import aes from "../utils/AesUtil.js"

export function auth(req, res, next) {
    const apiKey = req.headers['x-api-key']

    if (!apiKey) {
        return res.status(200).json({
            code: -1,
            message: 'Missing API Key'
        })
    }

    const decryptedApiKey = aes.decryptString(apiKey, process.env.API_SECRET_KEY)
    if (!decryptedApiKey || decryptedApiKey !== process.env.API_TOKEN) {
        return res.status(200).json({
            code: -1,
            message: 'Unauthorized'
        })
    }

    let ip = req.ip
    console.log('Request IP:', ip)
    if (ip.startsWith('::ffff:')) {
        ip = ip.substring(7)
    }

    const allowIps = process.env.ALLOW_IPS?.split(',') || []
    if (!allowIps.includes(ip)) {
        return res.status(200)
            .json({
                code: -1,
                message: 'IP forbidden'
            })
    }

    next()
}