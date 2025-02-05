import express from 'express'
import { parseBearer } from './octokit.js'
import * as controllers from './controllers.js'
import * as http from './http.js'
import winston from 'winston'
import expressWinston from 'express-winston'

const verbose = parseInt(process.env.VERBOSE) || 0

expressWinston.requestWhitelist.push('body')
expressWinston.responseWhitelist.push('headers', 'body')
const winstonOptions = {
  transports: [
    new winston.transports.Console()
  ],
  format: winston.format.combine(
    winston.format.prettyPrint(),
  ),
}

namespace PATHS {
  export const $recipe = '/:api/conans/:name/:version/:user/:channel'
  export const $rrev = `${$recipe}/revisions/:rrev`
  export const $package = `${$rrev}/packages/:package`
  export const $package1 = `${$recipe}/packages/:package`
  export const $prev = `${$package}/revisions/:prev`
}

const router = express.Router()

if (verbose > 0) {
  router.use(expressWinston.logger(winstonOptions))
}

router.get('/:api/ping', (req, res) => {
  res.set('X-Conan-Server-Capabilities', 'complex_search,revisions').send()
})

/**
 * Return the Basic token right back to the Conan client.
 * That token is a base64 encoding of `user:password`.
 * Conan passes whatever is returned as a Bearer token on future requests.
 * If users use their GitHub Personal Access Token as their password,
 * then we'll have what we need.
 */
router.get('/:api/users/authenticate', (req, res) => {
  const header = req.get('Authorization')
  if (!header) {
    throw http.badRequest('Missing header: Authorization')
  }
  const match = header.match(/Basic (.+)/)
  if (!match) {
    throw http.badRequest('Malformed header: Authorization')
  }
  res.type('text/plain').send(match[1])
})

router.get('/:api/users/check_credentials', async (req, res) => {
  const { user } = parseBearer(req)
  const client = req.get('X-Client-Id')
  if (user !== client) {
    console.warn(
      `Bearer token (${user}) does not match X-Client-Id (${client})`,
    )
  }
  // This function is called many times.
  // For now, we disable the call to GitHub to save on traffic costs.
  /*
     const { octokit } = newOctokit(req)
     const r1 = await octokit.rest.users.getAuthenticated()
     if (r1.status !== 200) {
     return res.status(401).send('Invalid GitHub token')
     }
     const login = r1.data.login
     if (login !== user) {
     console.warn(`Bearer token (${user}) does not match GitHub token (${login})`)
     }
     */
  return res.send(user)
})

// NOTE: Handles API v1 and v2 identically.
router.delete(`${PATHS.$recipe}`                , controllers.deleteRecipe)
router.get   (`${PATHS.$recipe}/latest`         , controllers.getRecipeLatest)
router.get   (`${PATHS.$recipe}/revisions`      , controllers.getRecipeRevisions)
router.get   (`${PATHS.$recipe}/search`         , controllers.getRecipeSearch)

router.delete(`${PATHS.$rrev}`                  , controllers.deleteRecipeRevision)
router.get   (`${PATHS.$rrev}/files`            , controllers.getRecipeRevisionFiles)
router.get   (`${PATHS.$rrev}/files/:filename`  , controllers.getRecipeRevisionFile)
router.put   (`${PATHS.$rrev}/files/:filename`  , controllers.putRecipeRevisionFile)
router.delete(`${PATHS.$rrev}/packages`         , controllers.deleteRecipeRevisionPackages)
router.get   (`${PATHS.$rrev}/search`           , controllers.getRecipeRevisionSearch)

router.get   (`${PATHS.$package}/latest`        , controllers.getPackageLatest)
router.get   (`${PATHS.$package}/revisions`     , controllers.getPackageRevisions)

router.delete(`${PATHS.$prev}`                  , controllers.deletePackageRevision)
router.get   (`${PATHS.$prev}/files`            , controllers.getPackageRevisionFiles)
router.get   (`${PATHS.$prev}/files/:filename`  , controllers.getPackageRevisionFile)
router.put   (`${PATHS.$prev}/files/:filename`  , controllers.putPackageRevisionFile)

// API v2 with revisions
router.get   (`/:api/conans/search`             , controllers.getSearch)

router.get   (`${PATHS.$recipe}`                , controllers.getRecipe)
router.get   (`${PATHS.$recipe}/digest`         , controllers.getRecipeDownloadUrls)
router.get   (`${PATHS.$recipe}/download_urls`  , controllers.getRecipeDownloadUrls)
router.post  (`${PATHS.$recipe}/upload_urls`    , controllers.postRecipeUploadUrls)

router.put(
  '/:api/files/:name/:version/:user/:channel/:rrev/export/:filename',
  controllers.putRecipeRevisionFile,
)

router.post  (`${PATHS.$recipe}/packages/delete`, controllers.postRecipePackagesDelete)

router.get   (`${PATHS.$package1}`              , controllers.getPackage)
router.get   (`${PATHS.$package1}/digest`       , controllers.getPackageDownloadUrls)
router.get   (`${PATHS.$package1}/download_urls`, controllers.getPackageDownloadUrls)
router.post  (`${PATHS.$package1}/upload_urls`  , controllers.postPackageUploadUrls)

router.put(
  '/:api/files/:name/:version/:user/:channel/:rrev/package/:package/:prev/:filename',
  controllers.putPackageRevisionFile,
)

router.get('/', (req, res) => {
  return res.redirect(301, 'https://github.com/thejohnfreeman/redirectory')
})

// The catcher for all unknown routes.
router.all('/*splat', (req, res) => {
  console.warn('unknown route', req.method, req.originalUrl)
  res.status(501).send()
})

if (verbose == 0) {
  router.use(expressWinston.errorLogger(winstonOptions))
}

// The catcher for all uncaught exceptions.
router.use((err, req, res, next) => {
  if (err instanceof http.Error) {
    return res.status(err.code).send(err.message)
  }
  return res.status(500).send(err.message)
})

export default router
