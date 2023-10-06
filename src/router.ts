import express from 'express'
import path from 'path'
import { parseBearer } from './octokit.js'
import * as controllers from './controllers.js'
import * as http from './http.js'

namespace PATHS {
  export const $recipe = '/:api/conans/:name/:version/:user/:channel'
  export const $rrev = `${$recipe}/revisions/:rrev`
  export const $package = `${$rrev}/packages/:package`
  export const $prev = `${$package}/revisions/:prev`
}

const router = express.Router()

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
     const octokit = newOctokit({ auth })
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

router.get   (`${PATHS.$recipe}`              , controllers.getRecipe)
router.delete(`${PATHS.$recipe}`              , controllers.deleteRecipe)
router.get   (`${PATHS.$recipe}/latest`       , controllers.getRecipeLatest)
router.get   (`${PATHS.$recipe}/revisions`    , controllers.getRecipeRevisions)
router.delete(`${PATHS.$rrev}`                , controllers.deleteRecipeRevision)
router.get   (`${PATHS.$rrev}/files`          , controllers.getRecipeRevisionFiles)
router.get   (`${PATHS.$rrev}/files/:filename`, controllers.getRecipeRevisionFile)
router.delete(`${PATHS.$rrev}/packages`       , controllers.deleteRecipeRevisionPackages)
router.get   (`${PATHS.$package}/latest`      , controllers.getPackageLatest)
router.get   (`${PATHS.$prev}/files`          , controllers.getPackageRevisionFiles)
router.get   (`${PATHS.$prev}/files/:filename`, controllers.getPackageRevisionFile)

router.all('*', (req, res) => {
  console.log(req.method, req.originalUrl)
  res.status(501).send()
})

router.use((err, req, res, next) => {
  console.error(err)
  if (err instanceof http.Error) {
    return res.status(err.code).send(err.message)
  }
  return res.status(500).send(err.message)
})

export default router
