import express from 'express'
import * as http from './http.js'
import { Client } from './octokit.js'
import * as std from './stdlib.js'

const MIME_TYPES = {
  '.txt': 'text/plain',
  '.py': 'text/x-python',
  '.tgz': 'application/gzip',
}

interface Release {
    id: number
    origin: string
}

interface Revision {
    id: string
    time: string
    // Missing in non-uploaded revisions, and when rrev === '0'.
    release?: Release
}

interface Revisible<T extends Revision = Revision> {
    revisions: T[]
}

interface Recipe extends Revisible<RecipeRevision> { }

interface RecipeRevision extends Revision {
    packages: Package[]
}

interface Package extends Revisible<PackageRevision> {
    id: string
}

interface PackageRevision extends Revision { }

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

interface Level {
    type: string
    tag: string
    reference: string
}

interface Resource<T> {
    level: Level
    value: T
}

interface Removable<T> extends Resource <T> {
    siblings: T[]
    index: number
}

interface Database {
    client: Client
    root: Root
}

interface Root {
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
  Promise<{ db: Database, $recipe: Resource<Recipe> }>
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

    const r1 = await client.getReleaseByTag(level.tag)
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
      // TODO: Do not catch this exception here.
      if (r2.status !== 201) {
        throw new http.Error(r2.status, r2.data.body)
      }

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

    return { db, $recipe }
}

export async function save({ root, client }: Database) {
  const body = root.prefix + Recipe.serialize(root.value) + root.suffix
  const r1 = await client.updateRelease(root.release.id, { body })
  if (r1.status !== 200) {
    throw http.badGateway(`Failed to update metadata: ${root.reference}`)
  }
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
  Promise<{ db: Database, $rrev: Removable<RecipeRevision> }>
{
  const { db, $recipe } = await getRecipe(req, force)
  const id = req.params.rrev
  const level = reviseLevel($recipe.level, id)
  const siblings = $recipe.value.revisions
  const { index, value } = getChild(level, siblings, id, force, {
    id,
    time: std.nowString(),
    packages: [],
  })
  const $rrev = { level, value, siblings, index }
  return { db, $rrev }
}

export async function getPackage(req: express.Request, force = false):
  Promise<{ db: Database, $package: Removable<Package> }>
{
  const { db, $rrev } = await getRecipeRevision(req, force)
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
  return { db, $package }
}

export async function getPackageRevision(req: express.Request, force = false):
  Promise<{ db: Database, $prev: Removable<PackageRevision> }>
{
  const { db, $package } = await getPackage(req, force)
  const id = this.req.params.prev
  const level = reviseLevel($package.level, id)
  const siblings = $package.value.revisions
  const { index, value } = getChild(level, siblings, id, force, {
    id,
    time: std.nowString(),
  })
  const $prev = { level, value, siblings, index }
  return { db, $prev }
}

export function getLatestRevision(resource: Resource<Recipe>): Removable<RecipeRevision>
export function getLatestRevision(resource: Resource<Package>): Removable<PackageRevision>
export function getLatestRevision(resource: Resource<Revisible>): Removable<Revision> {
  const siblings = resource.value.revisions
  if (siblings.length === 0) {
    throw missing(resource.level)
  }
  const { value, index } = std.maxBy(siblings, (revision) => revision.time)
  const level = reviseLevel(resource.level, value.id)
  return { level, value, siblings, index }
}

export function getRevisions(resource: Resource<Recipe>): { revision: string, time: string }[]
export function getRevisions(resource: Resource<Package>): { revision: string, time: string }[]
export function getRevisions(resource: Resource<Revisible>): { revision: string, time: string }[] {
  const siblings = resource.value.revisions
  if (siblings.length === 0) {
    throw missing(resource.level)
  }
  return siblings.map(({ id, time }) => ({
    revision: id,
    time,
  }))
}

export async function getRelease(
  db: Database, resource: Resource<Revision>, force = false,
): Promise<Release> {
  let release = resource.value.release
  if (!release) {
    let data: { id: number, upload_url: string }
    if (resource.value.id === '0' && resource.level.type === 'Recipe') {
      data = db.root.release
    } else if (!force) {
      throw http.notFound(`Missing release: ${resource.level.reference}`)
    } else {
      const r1 = await db.client.createRelease(resource.level.tag)
      if (r1.status !== 201) {
        throw http.badGateway(`Cannot create release: ${resource.level.reference}`)
      }
      data = r1.data
    }
    release = {
      id: data.id,
      origin: new URL(data.upload_url).origin,
    }
    resource.value.release = release
  }
  return release
}

interface Files {
  [name: string]: {
    md5: string
    url: string
  }
}

export async function getFiles(client: Client, level: Level, release: Release): Promise<Files> {
  const r1 = await client.getRelease(release.id)
  if (r1.status !== 200) {
    throw missing(level)
  }
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
