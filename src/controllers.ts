import * as model from './model.js'

export async function getRecipe(req, res) {
  const { db, $recipe } = await model.getRecipe(req)

  const $rrev = model.getLatestRevision($recipe)
  const release = await model.getRelease(db, $rrev)
  const files = await model.getFiles(db.client, $rrev.level, release)
  const body = {}
  for (const filename of Object.keys(files)) {
    body[filename] = {}
  }

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
  const $rrev = model.getLatestRevision($recipe)
  const { id, time } = $rrev.value
  res.send({ revision: id, time })
}

export async function getRecipeRevisions(req, res) {
  const { db, $recipe } = await model.getRecipe(req)
  const revisions = model.getRevisions($recipe)
  res.send(revisions)
}
