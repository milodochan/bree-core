import crypto from 'node:crypto'

const ALGORITHM_MAP = {
    16: 'aes-128-ecb',
    24: 'aes-192-ecb',
    32: 'aes-256-ecb'
}

const encrypt = (data, key) => {
    // key 必须 16 / 24 / 32 字节
    const keyBuf = Buffer.from(key, 'utf8')
    const cipher = crypto.createCipheriv(ALGORITHM_MAP[keyBuf.length], keyBuf, null)
    cipher.setAutoPadding(true) // PKCS7
    const encrypted = Buffer.concat([
        cipher.update(data),
        cipher.final()
    ])
    return encrypted
}

const decrypt = (data, key) => {
    const keyBuf = Buffer.from(key, 'utf8')
    const decipher = crypto.createDecipheriv(ALGORITHM_MAP[keyBuf.length], keyBuf, null)
    decipher.setAutoPadding(true)
    const decrypted = Buffer.concat([
        decipher.update(data),
        decipher.final()
    ])
    return decrypted
}

/**
 * AES解密
 * 对应 Java:
 * AesUtil.decrypt(String data, String key)
 *
 * @param {string} data Base64密文
 * @param {string} key AES密钥(16/24/32字节)
 * @returns {string} 明文
 */
const decryptString = (data, key) => {
    const keyBuf = Buffer.from(key, 'utf8')
    const decipher = crypto.createDecipheriv(ALGORITHM_MAP[keyBuf.length], keyBuf, null)
    decipher.setAutoPadding(true)
    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(data, 'base64')),
        decipher.final()
    ])
    return decrypted.toString('utf8')
}

export default { encrypt, decrypt, decryptString }