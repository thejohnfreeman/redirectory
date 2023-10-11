import { parseRepository } from './octokit.js'
import * as model from './model.js'

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
  const files = await model.getFiles(db, $rev.level, release)
  const body = mapObject(files, () => ({}))
  res.send(body)
}

const getUrls = (getRevisible) => async (req, res) => {
  const { db, $resource: $revisible } = await getRevisible(req)
  const $rev = model.getLatestRevision($revisible)
  const release = await model.getRelease(db, $rev)
  const files = await model.getFiles(db, $rev.level, release)
  const body = mapObject(files, ({ url }) => url)
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
  const files = await model.getFiles(db, $rrev.level, release)
  const body = mapObject(files, ({ md5 }) => md5)
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
export const getRecipeUrls = getUrls(model.getRecipe)

export async function getRecipeRevisions(req, res) {
  const { db, $resource: $recipe } = await model.getRecipe(req)
  const revisions = model.getRevisions($recipe)
  res.send(revisions)
}

export async function deleteRecipeRevision(req, res) {
  const { db, $resource: $rrev } = await model.getRecipeRevision(req)

  await Promise.all(model.deleteRecipeRevision(db, $rrev.value))
  $rrev.siblings.splice($rrev.index, 1)
  await model.save(db)

  return res.send()
}

export const getRecipeRevisionFiles = getFiles(model.getRecipeRevision)
export const getRecipeRevisionFile = getFile(model.getRecipeRevision)
export const putRecipeRevisionFile = putRevisionFile(model.getRecipeRevision)

export async function deleteRecipeRevisionPackages(req, res) {
  const { db, $resource: $rrev } = await model.getRecipeRevision(req)

  await Promise.all(model.deletePackages(db, $rrev.value))
  $rrev.value.packages = []
  await model.save(db)

  return res.send()
}

export const getPackageLatest = getLatest(model.getPackage)

export const getPackageRevisionFiles = getFiles(model.getPackageRevision)
export const getPackageRevisionFile = getFile(model.getPackageRevision)
export const putPackageRevisionFile = putRevisionFile(model.getPackageRevision)
