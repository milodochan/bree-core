import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

register('./tmp-loader.mjs', pathToFileURL('./.tmp-test/'))
