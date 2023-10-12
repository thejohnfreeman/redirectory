import { parseBearer, parseRepository } from './octokit.js'
import * as model from './model.js'
import jwt from 'jsonwebtoken'

function mapObject(object, fn) {
  return Object.fromEntries(Object.entries(object).map(([k, v]) => [k, fn(v)]))
}

const getLatest = (getRevisible) => async (req, res) => {
  const { db, $resource: $revisible } = await getRevisible(req)
  const $rev = model.getLatestRevision($revisible)
  const { id, time } = $rev.value
  res.send({ revision: id, time })
}

const getFile = (getLevel) => (req, res) => {
  const repo = parseRepository(req)
  const level = getLevel(req)
  const url = model.getFile(repo, level, req.params.filename)
  return res.redirect(301, url)
}

const getFiles = (getRevision) => async (req, res) => {
  const { db, $resource: $rev } = await getRevision(req)
  const release = await model.getRelease(db, $rev)
  const assets = await model.getAssets(db, $rev.level, release)
  const files = mapObject(assets, () => ({}))
  res.send({ files })
}

const getDownloadUrls = (getRevisible) => async (req, res) => {
  const { db, $resource: $revisible } = await getRevisible(req)
  const $rev = model.getLatestRevision($revisible)
  const release = await model.getRelease(db, $rev)
  const assets = await model.getAssets(db, $rev.level, release)
  const body = mapObject(assets, ({ url }) => url)
  res.send(body)
}

function readStream(stream): Promise<string> {
  return new Promise((resolve, reject) => {
    // += is 75% faster than Array.join.
    let data = ''
    stream.on('data', chunk => data += chunk)
    stream.on('end', () => resolve(data))
    stream.on('error', error => reject(error))
  })
}

const SIGNING_KEY = 'abcd1234'

const getUploadUrls = async (req, res) => {
  // Just for the check.
  const level = model.getRecipeLevel(req)
  const { name, version, user, channel } = req.params
  const { auth, user: username } = parseBearer(req)
  const json = await readStream(req)
  const files = JSON.parse(json)
  const body = {}
  // Expires 30 minutes into the future?
  const SECONDS_PER_MINUTE = 60
  const exp = Math.floor(new Date().getTime() / 1000) + 30 * SECONDS_PER_MINUTE
  for (const filename of Object.keys(files)) {
    const resource_path = `${name}/${version}/${user}/${channel}/0/export/${filename}`
    const filesize = files[filename]
    const token = jwt.sign({
      resource_path,
      username,
      filesize,
      exp
    }, SIGNING_KEY, {
      noTimestamp: true
    })
    // TODO: Encode the `user` and `auth` query parameters.
    body[filename] = `${req.protocol}://${req.headers.host}/v1/files/${resource_path}?signature=${token}&user=${username}&auth=${auth}`
  }
  res.send(body)
}

const putRevisionFile = (getRevision) => async (req, res) => {
  const { db, $resource: $rev } = await getRevision(req, /*force=*/true)
  const release = await model.getRelease(db, $rev, /*force=*/true)
  const data = await model.putFile(db, release, req)
  release.assets[data.name] = {
    md5: data.md5,
    url: data.browser_download_url,
  }
  await model.save(db)
  return res.status(201).send()
}

export async function getRecipe(req, res) {
  const { db, $resource: $recipe } = await model.getRecipe(req)
  const $rrev = model.getLatestRevision($recipe)
  const release = await model.getRelease(db, $rrev)
  const assets = await model.getAssets(db, $rrev.level, release)
  const body = mapObject(assets, ({ md5 }) => md5)
  return res.send(body)
}

export async function deleteRecipe(req, res) {
  const { db, $resource: $recipe } = await model.getRecipe(req)

  await Promise.all(model.deleteRecipe(db, $recipe.value))
  $recipe.value.revisions = []
  await model.save(db)

  return res.send()
}

export const getRecipeLatest = getLatest(model.getRecipe)
export const getRecipeDownloadUrls = getDownloadUrls(model.getRecipe)
export const getRecipeUploadUrls = getUploadUrls

export async function getRecipeRevisions(req, res) {
  const { db, $resource: $recipe } = await model.getRecipe(req)
  const revisions = model.getRevisions($recipe)
  res.send({ revisions })
}

export async function deleteRecipeRevision(req, res) {
  const { db, $resource: $rrev } = await model.getRecipeRevision(req)

  await Promise.all(model.deleteRecipeRevision(db, $rrev.value))
  $rrev.siblings.splice($rrev.index, 1)
  await model.save(db)

  return res.send()
}

export const getRecipeRevisionFiles = getFiles(model.getRecipeRevision)
export const getRecipeRevisionFile = getFile(model.getRecipeRevisionLevel)
export const putRecipeRevisionFile = putRevisionFile(model.getRecipeRevision)

export async function deleteRecipeRevisionPackages(req, res) {
  const { db, $resource: $rrev } = await model.getRecipeRevision(req)

  await Promise.all(model.deletePackages(db, $rrev.value))
  $rrev.value.packages = []
  await model.save(db)

  return res.send()
}

export const getPackageLatest = getLatest(model.getPackage)

export function getPackageDownloadUrls(req, res) {
  req.params.rrev = '0'
  return getDownloadUrls(model.getPackage)(req, res)
}

export const getPackageRevisionFiles = getFiles(model.getPackageRevision)
export const getPackageRevisionFile = getFile(model.getPackageRevisionLevel)
export const putPackageRevisionFile = putRevisionFile(model.getPackageRevision)
