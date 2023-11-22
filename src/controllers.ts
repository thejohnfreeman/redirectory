import { newOctokit, parseBearer, parseRepository } from './octokit.js'
import * as http from './http.js'
import * as model from './model.js'
import * as std from './stdlib.js'
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

const getRevisions = (getRevisible) => async (req, res) => {
  const { db, $resource: $revisible } = await getRevisible(req)
  const revisions = model.getRevisions($revisible)
  res.send({ revisions })
}

/*
 * GET /v2/conans/:recipe/revisions/:rrev/packages/:package/revisions/:prev/files/:filename
 * GET /v1/files/:recipe/:rrev/package/:package/:prev/:filename?signature&user&auth
 */
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
  return res.send({ files })
}

/*
 * GET /v1/conans/:recipe
 * 200 { ":filename": ":md5", ... }
 *
 * GET /v1/conans/:recipe/packages/:package
 * 200 { ":filename": ":md5", ... }
 */
const getFileSums = (getRevisible) => async (req, res) => {
  const { db, $resource: $revisible } = await getRevisible(req)
  const $rev = model.getLatestRevision($revisible)
  const release = await model.getRelease(db, $rev)
  const assets = await model.getAssets(db, $rev.level, release)
  const body = mapObject(assets, ({ md5 }) => md5)
  return res.send(body)
}

/*
 * GET /v1/conans/:recipe/download_urls
 * Returns the latest RREV.
 * Must return URLs that work even with no Authorization header.
 * GitHub browser download URLs do not require one.
 * 200 { ":filename": "http://host:port/v1/files/:recipe/:rrev/export/:filename?signature=...", ... }
 * 200 { ":filename": ":browser_download_url", ... }
 *
 * GET /v1/conans/:recipe/packages/:package/download_urls
 * Returns the latest PREV of the latest RREV.
 * Ignores earlier RREVs,
 * even if they have the package but the latest RREV does not.
 * 200 { ":filename": "http://host:port/v1/files/:recipe/:rrev/package/:package/:prev/:filename?signature=...", ... }
 * 200 { ":filename": ":browser_download_url", ... }
 */
const getDownloadUrls = (getRevisible) => async (req, res) => {
  const { db, $resource: $revisible } = await getRevisible(req)
  const $rev = model.getLatestRevision($revisible)
  const release = await model.getRelease(db, $rev)
  const assets = await model.getAssets(db, $rev.level, release)
  const body = mapObject(assets, ({ url }) => url)
  return res.send(body)
}

const SIGNING_KEY = 'abcd1234'

/*
 * POST /v1/conans/:recipe/upload_urls
 * Must return URLs that work even with no Authorization header.
 * TODO: Must we include the signature?
 * Is it necessary to get the client to send the correct Content-Length header?
 * Can we send a token with less information, e.g. just the file size?
 * 200
 * { ":filename": :filesize, ... }
 * signature = jwt({
 *   resource_path: ":recipe/0/export/:filename",
 *   username: ":user",
 *   filesize: :filesize,
 *   exp: now().time() + 30m,
 * })
 * { ":filename": "http://host:port/v1/files/:recipe/0/export/:filename?signature", ... }
 *
 * POST /v1/conans/:recipe/packages/:package/upload_urls
 * { ":filename": :filesize, ... }
 * 200
 * signature = jwt({
 *   resource_path: ":recipe/0/package/:package/0/:filename",
 *   username: ":user",
 *   filesize: :filesize,
 *   exp: now().time() + 30m,
 * })
 * { ":filename": "http://host:port/v1/files/:recipe/0/package/:package/0/:filename?signature", ... }
 */
const postUploadUrls = (uploadPath) => async (req, res) => {
  // Just for the check.
  model.getRecipeLevel(req)
  const { name, version, user, channel } = req.params
  const { auth, user: username } = parseBearer(req)
  const json = await std.readStream(req)
  const files = JSON.parse(json)
  const body = {}
  // Expires 30 minutes into the future?
  const SECONDS_PER_MINUTE = 60
  const exp = Math.floor(new Date().getTime() / 1000) + 30 * SECONDS_PER_MINUTE
  for (const filename of Object.keys(files)) {
    const subpath = uploadPath(req)
    const resource_path = `${name}/${version}/${user}/${channel}/0/${subpath}/${filename}`
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
  const mode = model.Mode.Create
  const { db, $resource: $rev } = await getRevision(req, mode)
  const release = await model.getRelease(db, $rev, mode)
  const data = await model.putFile(db, release, req)
  release.assets[data.name] = {
    md5: data.md5,
    url: data.browser_download_url,
  }
  await model.save(db)
  return res.status(201).send()
}

export const getRecipe = getFileSums(model.getRecipe)

export async function deleteRecipe(req, res) {
  const mode = model.Mode.ReadWrite
  const { db, $resource: $recipe } = await model.getRecipe(req,mode)

  await Promise.all(model.deleteRecipe(db, $recipe.value))
  $recipe.value.revisions = []
  await model.save(db)

  return res.send()
}

export const getRecipeLatest = getLatest(model.getRecipe)
export const getRecipeRevisions = getRevisions(model.getRecipe)
export const getRecipeDownloadUrls = getDownloadUrls(model.getRecipe)
export const postRecipeUploadUrls = postUploadUrls(() => 'export')

export async function deleteRecipeRevision(req, res) {
  const mode = model.Mode.ReadWrite
  const { db, $resource: $rrev } = await model.getRecipeRevision(req, mode)

  await Promise.all(model.deleteRecipeRevision(db, $rrev.value))
  $rrev.siblings.splice($rrev.index, 1)
  await model.save(db)

  return res.send()
}

export const getRecipeRevisionFiles = getFiles(model.getRecipeRevision)
export const getRecipeRevisionFile = getFile(model.getRecipeRevisionLevel)
export const putRecipeRevisionFile = putRevisionFile(model.getRecipeRevision)

export async function deleteRecipeRevisionPackages(req, res) {
  const mode = model.Mode.ReadWrite
  const { db, $resource: $rrev } = await model.getRecipeRevision(req, mode)

  await Promise.all(model.deletePackages(db, $rrev.value))
  $rrev.value.packages = []
  await model.save(db)

  return res.send()
}

export const getPackageLatest = getLatest(model.getPackage)
export const getPackageRevisions = getRevisions(model.getPackage)

export const getPackage = getFileSums(model.getLatestPackage)
export const getPackageDownloadUrls = getDownloadUrls(model.getLatestPackage)
export const postPackageUploadUrls = postUploadUrls(
  req => `package/${req.params.package}/0`
)

export async function deletePackageRevision(req, res) {
  const mode = model.Mode.ReadWrite
  const { db, $resource: $prev } = await model.getPackageRevision(req, mode)

  await model.deleteRevision(db, $prev.value)
  $prev.siblings.splice($prev.index, 1)
  // TODO: What if that was the only revision? Should delete package too.
  await model.save(db)

  return res.send()
}

export const getPackageRevisionFiles = getFiles(model.getPackageRevision)
export const getPackageRevisionFile = getFile(model.getPackageRevisionLevel)
export const putPackageRevisionFile = putRevisionFile(model.getPackageRevision)

/*
 * POST /v1/conans/:recipe/packages/delete
 * {"package_ids": [":package", ...]}
 * 200
 */
export async function postRecipePackagesDelete(req, res) {
  const mode = model.Mode.ReadWrite
  const { db, $resource: $recipe } = await model.getRecipe(req, mode)
  const $rrev = model.getLatestRevision($recipe)
  const json = await std.readStream(req)
  const { package_ids } = JSON.parse(json)
  if (package_ids.length === 0) {
    await Promise.all(model.deletePackages(db, $rrev.value))
    $rrev.value.packages = []
  } else {
    const promises = package_ids.flatMap(id => {
      const $package = model.findPackage($rrev, id)
      $package.siblings.splice($package.index, 1)
      return model.deletePackage(db, $package.value)
    })
    await Promise.all(promises)
  }
  await model.save(db)
  return res.send()
}

/*
 * GET /v1/conans/:recipe/search
 * 200 { ":package": { "content": ":conaninfo.txt", "settings": { ... }, "options": { ... }, "full_requires": [ ... ], "recipe_hash": ":rrev" }, ... }
 */
export function getRecipeSearch(req, res) {
  // TODO: Implement?
  return res.status(501).send()
}

/*
 * GET /v1/conans/:recipe/revisions/:rrev/search
 * `conaninfo.txt` for latest prev of each package of rrev.
 * 200 { ":package": { "content": ":conaninfo.txt" }, ... }
 */
export async function getRecipeRevisionSearch(req, res) {
  const { db, $resource: $rrev } = await model.getRecipeRevision(req)
  // TODO: Get content?
  const entries = $rrev.value.packages.map($package => [$package.id, { content: '' }])
  res.send(Object.fromEntries(entries))
}

// Query parameter for search function.
// Must come in the form 'nameGlob[/versionGlob[@]]'.
// Globs may use zero or more asterisks (*),
// and may not use separators (/#@).
// No other special characters are recognized.
const PATTERN_SEARCH_QUERY = /^([^/#@]+)(?:\/([^/#@]+)@?)?$/

// Tag for recipe release.
// Must be a version string with an optional revision suffix,
// i.e. 'version[#revision]'.
// Conan limits revision identifiers to 51 alphanumeric characters.
const PATTERN_TAG_RECIPE = /^([^/#@]+)(?:#[a-zA-Z0-9]{1,51})?$/

export async function getSearch(req, res) {
  const query = req.query.q

  const results = []

  let m = PATTERN_SEARCH_QUERY.exec(query)
  if (!m) {
    // Invalid query strings quietly return zero results.
    return res.send({ results })
  }
  const nameGlob = m[1]
  const versionGlob = m[2]

  // GitHub search only matches substrings, not regexes or globs.
  // Take first non-empty string from `glob.split('*')`.
  const nameSubstring = nameGlob.split('*').filter(x => x)[0]
  if (!nameSubstring) {
    // An empty string or single asterisk typically returns all packages.
    // For now, we return none.
    // TODO: Implement match-all query.
    return res.send({ results })
  }

  const { octokit } = newOctokit(req)
  const r1 = await octokit.rest.search.repos({
    q: `${nameSubstring} in:name topic:redirectory`,
    sort: 'stars',
    order: 'desc',
  })

  const nameRegex = new RegExp(
    '^' + nameGlob.split('*').map(std.escapeRegExp).join('.*') + '$'
  )
  for (const result of r1.data.items) {
    const repo = result.name
    // Now we can pattern match against the full given query.
    // Conan does _NOT_ match on substrings in the absence of a glob.
    // The given pattern must match the entire name.
    if (!nameRegex.exec(repo)) {
      continue
    }
    const owner = result.owner.login
    const r2 = await octokit.rest.repos.listReleases({ owner, repo })
    for (const release of r2.data) {
      const tag = release.tag_name
      let m = PATTERN_TAG_RECIPE.exec(tag)
      if (!m) {
        // We are looking for only recipe releases.
        continue
      }
      const version = m[1]
      // The version filter is optional.
      if (versionGlob) {
        const versionRegex = new RegExp(
          '^' + versionGlob.split('*').map(std.escapeRegExp).join('.*') + '$'
        )
        if (!versionRegex.exec(version)) {
          continue
        }
      }
      if (!release.assets.map(a => a.name).includes('conanmanifest.txt')) {
        continue
      }
      // TODO: Good way to translate backwards from release to reference?
      results.push(`${repo}/${version}@github/${owner}`)
    }
  }

  return res.send({ results })
}
