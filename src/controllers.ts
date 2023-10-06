import * as model from './model.js'

function mapObject(object, fn) {
  return Object.fromEntries(Object.entries(object).map(([k, v]) => [k, fn(v)]))
}

function getLatest(resource, res) {
  const $rev = model.getLatestRevision(resource)
  const { id, time } = $rev.value
  res.send({ revision: id, time })
}

async function getFiles(
  db: model.Database, resource: model.Resource<model.Revision>, res,
) {
  const release = await model.getRelease(db, resource)
  const files = await model.getFiles(db, resource.level, release)
  const body = mapObject(files, () => ({}))
  res.send(body)
}

export async function getRecipe(req, res) {
  const { db, $recipe } = await model.getRecipe(req)
  const $rrev = model.getLatestRevision($recipe)
  const release = await model.getRelease(db, $rrev)
  const files = await model.getFiles(db, $rrev.level, release)
  const body = mapObject(files, ({ md5 }) => md5)
  return res.send(body)
}

export async function deleteRecipe(req, res) {
  const { db, $recipe } = await model.getRecipe(req)

  await Promise.all(model.deleteRecipe(db.client, $recipe.value))
  $recipe.value.revisions = []
  await model.save(db)

  return res.send()
}

export async function getRecipeLatest(req, res) {
  const { db, $recipe } = await model.getRecipe(req)
  return getLatest($recipe, res)
}

export async function getRecipeRevisions(req, res) {
  const { db, $recipe } = await model.getRecipe(req)
  const revisions = model.getRevisions($recipe)
  res.send(revisions)
}

export async function deleteRecipeRevision(req, res) {
  const { db, $rrev } = await model.getRecipeRevision(req)

  await Promise.all(model.deleteRecipeRevision(db.client, $rrev.value))
  $rrev.siblings.splice($rrev.index, 1)
  await model.save(db)

  return res.send()
}

export async function getRecipeRevisionFiles(req, res) {
  const { db, $rrev } = await model.getRecipeRevision(req)
  return getFiles(db, $rrev, res)
}

export async function getRecipeRevisionFile(req, res) {
  // TODO: Do not open the database. Just parse the parameters.
  const { db, $rrev } = await model.getRecipeRevision(req)
  const url = model.getFile(db, $rrev, req.params.filename)
  return res.redirect(301, url)
}

export async function deleteRecipeRevisionPackages(req, res) {
  const { db, $rrev } = await model.getRecipeRevision(req)

  await Promise.all(model.deletePackages(db.client, $rrev.value))
  $rrev.value.packages = []
  await model.save(db)

  return res.send()
}

export async function getPackageLatest(req, res) {
  const { db, $package } = await model.getPackage(req)
  return getLatest($package, res)
}

export async function getPackageRevisionFiles(req, res) {
  const { db, $prev } = await model.getPackageRevision(req)
  return getFiles(db, $prev, res)
}

export async function getPackageRevisionFile(req, res) {
  // TODO: Do not open the database. Just parse the parameters.
  const { db, $prev } = await model.getPackageRevision(req)
  const url = model.getFile(db, $prev, req.params.filename)
  return res.redirect(301, url)
}
