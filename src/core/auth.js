import aes from "../utils/aesUtil.js"

const getClientIp = (req) => {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
        || req.headers['x-real-ip']
        || req.ip
        || req.connection.remoteAddress
}

export function auth(req, res, next) {
    const headerName = process.env.API_SECRET_KEY_NAME.toLowerCase()
    const apiKey = req.headers[headerName]
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

    const ip = getClientIp(req)
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