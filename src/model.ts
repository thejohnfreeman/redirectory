import express from 'express'
import path from 'path'
import * as http from './http.js'
import { Client, getResponse } from './octokit.js'
import * as std from './stdlib.js'

const MIME_TYPES = {
  '.txt': 'text/plain',
  '.py': 'text/x-python',
  '.tgz': 'application/gzip',
}

export interface Release {
    id: number
    origin: string
}

export interface Revision {
    id: string
    time: string
    // Missing in non-uploaded revisions, and when rrev === '0'.
    release?: Release
}

export interface Revisible<T extends Revision = Revision> {
    revisions: T[]
}

export interface Recipe extends Revisible<RecipeRevision> { }

export interface RecipeRevision extends Revision {
    packages: Package[]
}

export interface Package extends Revisible<PackageRevision> {
    id: string
}

export interface PackageRevision extends Revision { }

namespace Recipe {
  export function serialize($recipe: Recipe): string {
    return (
      '<!--redirectory\n' +
      'Do not edit or remove this comment.\n' +
      JSON.stringify($recipe, null, 2) +
      '\n-->'
    )
  }
}

export interface Level {
    type: string
    tag: string
    reference: string
}

export interface Resource<T> {
    level: Level
    value: T
}

export interface Removable<T> extends Resource <T> {
    siblings: T[]
    index: number
}

export interface Database {
    client: Client
    root: Root
}

export interface Root {
    reference: string
    release: {
      id: number
      upload_url: string
      assets: { id: number; name: string; browser_download_url: string }[]
    },
    value: Recipe
    prefix: string
    suffix: string
}

function missing(level: Level) {
    return http.notFound(`${level.type} missing: ${level.reference}`)
}

function reviseLevel(level: Level, id: string) {
  level = { ...level }
  if (id !== '0') {
    level.tag += '#' + id
    level.reference += '#' + id
  }
  return level
}

export async function getRecipe(req: express.Request, force = false):
  Promise<{ db: Database, $resource: Resource<Recipe> }>
{
    const client = Client.new(req)

    const { name, version, user, channel } = req.params
    const reference = `${name}/${version}@${user}/${channel}`
    if (user !== 'github') {
      throw http.forbidden(`Not a GitHub package: '${reference}'`)
    }

    const level = { type: 'Recipe', tag: version, reference }

    let release
    let value: Recipe = {
      revisions: [{ id: '0', time: std.nowString(), packages: [] }],
    }
    // If the body is entirely an HTML comment, GitHub will show it.
    // Use a non-whitespace HTML string that renders as whitespace
    // to hide the comment.
    let prefix = '&nbsp;\n'
    let suffix = ''

    const r1 = await client.getReleaseByTag(level.tag).catch(getResponse)
    if (r1.status !== 200) {
      if (!force) {
        throw missing(level)
      }

      // This will create the root tag,
      // pointing at the tip of the default branch,
      // if it does not exist.
      const r2 = await client.createRelease(level.tag, {
        body: prefix + Recipe.serialize(value),
      })
      // Exception deliberately uncaught.
      release = r2.data
    } else {
      release = r1.data

      const body = r1.data.body || prefix
      let match = body.match(
        /([\s\S]*)<!--\s*redirectory\s*([\s\S]*?)\s*-->([\s\S]*)/,
      )
      if (match) {
        prefix = match[1]
        suffix = match[3]
        let comment = match[2]
        comment = comment.substring(comment.indexOf('{'))
        try {
          value = std.parseJsonPrefix(comment)
        } catch (error) {
          throw http.badGateway(`Bad metadata comment: ${reference}`)
        }
      } else {
        prefix = body
        value = { revisions: [] }
      }
    }

    const root = { reference, release, value, prefix, suffix }
    const db = { client, root }
    const $recipe = { level, value }

    return { db, $resource: $recipe }
}

export async function save({ root, client }: Database) {
  const body = root.prefix + Recipe.serialize(root.value) + root.suffix
  await client.updateRelease(root.release.id, { body })
  // Exception deliberately uncaught.
}

function getChild<T extends { id: string }>(
  level: Level, children: T[], id: string, force: boolean, child: T,
): { index: number, value: T } {
  let index = children.findIndex(child => child.id === id)
  if (index < 0) {
    if (!force) {
      throw missing(level)
    }
    index = children.length
    children.push(child)
  }
  const value = children[index]
  return { index, value }
}

export async function getRecipeRevision(req: express.Request, force = false):
  Promise<{ db: Database, $resource: Removable<RecipeRevision> }>
{
  const { db, $resource: $recipe } = await getRecipe(req, force)
  const id = req.params.rrev
  const level = reviseLevel($recipe.level, id)
  const siblings = $recipe.value.revisions
  const { index, value } = getChild(level, siblings, id, force, {
    id,
    time: std.nowString(),
    packages: [],
  })
  const $rrev = { level, value, siblings, index }
  return { db, $resource: $rrev }
}

export async function getPackage(req: express.Request, force = false):
  Promise<{ db: Database, $resource: Removable<Package> }>
{
  const { db, $resource: $rrev } = await getRecipeRevision(req, force)
  const id = this.req.params.package
  if (id === '0') {
    throw http.badRequest(`invalid package ID: ${id}`)
  }
  const level = { ...$rrev.level }
  level.type = 'Package'
  level.tag += '@' + id
  level.reference += ':' + id
  const siblings = $rrev.value.packages
  const { index, value } = getChild(level, siblings, id, force, {
    id,
    revisions: [],
  })
  const $package = { level, value, siblings, index }
  return { db, $resource: $package }
}

export async function getPackageRevision(req: express.Request, force = false):
  Promise<{ db: Database, $resource: Removable<PackageRevision> }>
{
  const { db, $resource: $package } = await getPackage(req, force)
  const id = this.req.params.prev
  const level = reviseLevel($package.level, id)
  const siblings = $package.value.revisions
  const { index, value } = getChild(level, siblings, id, force, {
    id,
    time: std.nowString(),
  })
  const $prev = { level, value, siblings, index }
  return { db, $resource: $prev }
}

export function getLatestRevision($revisible: Resource<Recipe>): Removable<RecipeRevision>
export function getLatestRevision($revisible: Resource<Package>): Removable<PackageRevision>
export function getLatestRevision($revisible: Resource<Revisible>): Removable<Revision> {
  const siblings = $revisible.value.revisions
  if (siblings.length === 0) {
    throw missing($revisible.level)
  }
  const { value, index } = std.maxBy(siblings, (revision) => revision.time)
  const level = reviseLevel($revisible.level, value.id)
  return { level, value, siblings, index }
}

export function getRevisions($revisible: Resource<Recipe>): { revision: string, time: string }[]
export function getRevisions($revisible: Resource<Package>): { revision: string, time: string }[]
export function getRevisions($revisible: Resource<Revisible>): { revision: string, time: string }[] {
  const siblings = $revisible.value.revisions
  if (siblings.length === 0) {
    throw missing($revisible.level)
  }
  return siblings.map(({ id, time }) => ({
    revision: id,
    time,
  }))
}

export async function getRelease(
  db: Database, $revision: Resource<Revision>, force = false,
): Promise<Release> {
  let release = $revision.value.release
  if (!release) {
    let data: { id: number, upload_url: string }
    if ($revision.value.id === '0' && $revision.level.type === 'Recipe') {
      data = db.root.release
    } else if (!force) {
      throw http.notFound(`Missing release: ${$revision.level.reference}`)
    } else {
      const r1 = await db.client.createRelease($revision.level.tag)
      // TODO: Handle existing release unrecorded in root metadata.
      // Exception deliberately uncaught.
      data = r1.data
    }
    release = {
      id: data.id,
      origin: new URL(data.upload_url).origin,
    }
    $revision.value.release = release
  }
  return release
}

interface Files {
  [name: string]: {
    md5: string
    url: string
  }
}

export async function getFiles({ client }: Database, level: Level, release: Release): Promise<Files> {
  const r1 = await client.getRelease(release.id)
  // Exception deliberately uncaught.
  const files = {}
  for (const asset of r1.data.assets) {
    files[asset.name] = {
      // TODO: Fill these values.
      md5: '',
      url: '',
    }
  }
  return files
}

export function getFile(db: Database, $revision: Resource<Revision>, filename: string): string {
  // It seems we can assume the download URL.
  return `https://github.com/${db.client.owner}/${db.client.repo}/releases/download/${encodeURIComponent($revision.level.tag)}/${filename}`
}

export async function putFile(db: Database, release: Release, req: express.Request) {
  const { filename } = req.params
  const extension = path.extname(filename)
  const mimeType = MIME_TYPES[extension] || 'application/octet-stream'

  return fetch(
    `${release.origin}/repos/${db.client.owner}/${db.client.repo}/releases/${release.id}/assets?name=${filename}`,
      {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${db.client.auth}`,
        'Content-Type': mimeType,
        'Content-Length': req.get('Content-Length'),
        'X-GitHub-Api-Version': '2022-11-28',
      },
      duplex: 'half',
      body: req,
    } as any,
  )
}

export async function deleteRevision(client: Client, revision: Revision) {
  const release = revision.release
  if (!release) {
    return
  }
  const success = await client.deleteRelease(release.id)
  if (!success) {
    throw http.badGateway(`Cannot delete release: ${release.id}`)
  }
}

export function deletePackages(client: Client, $rrev: RecipeRevision): Promise<unknown>[] {
  return $rrev.packages
    .flatMap($package => $package.revisions)
    .flatMap($prev => deleteRevision(client, $prev))
}

export function deleteRecipeRevision(client: Client, $rrev: RecipeRevision): Promise<unknown>[] {
  const promises = deletePackages(client, $rrev)
  const release = $rrev.release
  if (release) {
    if ($rrev.id === '0') {
      // TODO: Delete assets.
    } else {
      promises.push(client.deleteRelease(release.id))
    }
  }
  return promises
}

export function deleteRecipe(client: Client, $recipe: Recipe): Promise<unknown>[] {
  return $recipe.revisions.flatMap($rrev => deleteRecipeRevision(client, $rrev))
}
