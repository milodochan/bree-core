import { pathToFileURL } from 'node:url'

const stub = pathToFileURL('./.tmp-test/tmp-knex-stub.mjs').href

export async function resolve(specifier, context, nextResolve) {
    if (specifier === 'knex') return { url: stub, format: 'module', shortCircuit: true }
    return nextResolve(specifier, context)
}
