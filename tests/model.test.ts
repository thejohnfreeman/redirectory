import 'expect-more-jest'
import { readFileSync } from 'fs'
import { Octokit } from 'octokit'
import { Readable } from 'node:stream'
import * as controllers from '../src/controllers'

const auth = readFileSync('github.token').toString().trim()
const kit = new Octokit({ auth })

const owner = 'thejohnfreeman'
const repo = 'zlib'
const tag = '1.2.13'

const bearer = 'Bearer ' + Buffer.from(`${owner}:${auth}`).toString('base64')

function isIsoString(value) {
  expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{9}Z$/)
  expect(Date.parse(value)).not.toBeNaN()
}

function fakeRequest(
  { headers = {}, params = {}, body = {} }: {
    headers?: Record<string, string>,
    params?: Record<string, string>,
    body?: any,
  } = {}
) {
  body.headers = { 'Authorization': bearer, ...headers }
  body.get = function (header) { return this.headers[header] }
  body.params = {
    name: repo,
    version: tag,
    user: 'github',
    channel: owner,
    ...params,
  }
  return body
}

const fakeResponse = () => ({
  send: jest.fn(),
  status: jest.fn().mockReturnThis(),
  redirect: jest.fn(),
})

test.skip('octokit', async () => {
  const r = await kit.rest.repos.getReleaseByTag({ owner, repo, tag })
  expect(r.status).toBe(200)
})

test.skip('GET /:recipe', async () => {
  const req = fakeRequest()
  const res = fakeResponse()
  await controllers.getRecipe(req, res)
  expect(res.send).toBeCalledWith({
    'conanfile.py': '',
    'conanmanifest.txt': '',
    'conan_export.tgz': '',
    'conan_sources.tgz': '',
  })
})

const expectRevision = {
  revision: expect.stringMatching(/[a-z0-9]+/),
  time: expect.toBeIso8601(),
}

test.skip('GET /:recipe/latest', async () => {
  const req = fakeRequest()
  const res = fakeResponse()
  await controllers.getRecipeLatest(req, res)
  expect(res.send).toBeCalledWith(expectRevision)
})

test.skip('GET /:recipe/revisions', async () => {
  const req = fakeRequest()
  const res = fakeResponse()
  await controllers.getRecipeRevisions(req, res)
  expect(res.send).toBeCalledWith(expect.toBeArrayOf(expectRevision))
})

test.skip('GET /:rrev/files', async () => {
  const req = fakeRequest({ params: { rrev: '0' } })
  const res = fakeResponse()
  await controllers.getRecipeRevisionFiles(req, res)
  expect(res.send).toBeCalledWith({
    'conanfile.py': {},
    'conanmanifest.txt': {},
    'conan_export.tgz': {},
    'conan_sources.tgz': {},
  })
})

test.skip('GET /:rrev/file/:filename', async () => {
  const req = fakeRequest({ params: { rrev: '0', filename: 'conanmanifest.txt' } })
  const res = fakeResponse()
  await controllers.getRecipeRevisionFile(req, res)
  expect(res.redirect).toBeCalledWith(
    301, expect.stringMatching(/^https:\/\/github.com\//),
  )
})

async function deleteReleases(version: string) {
  const response = await kit.rest.repos.listReleases({ owner, repo })
  const releases = response.data.filter(
    ({ tag_name }) => RegExp(`${version}($|[#@])`).test(tag_name)
  )
  const ids = releases.map(({ id }) => id)
  await Promise.all(ids.map(
    id => kit.rest.repos.deleteRelease({ owner, repo, release_id: id })
  ))
}

test.skip('PUT /:rrev/file/:filename', async () => {
  const version = '0.1.2'
  await deleteReleases(version)

  // First request has an incorrect size,
  // which stops the upload
  // but not until after creating the release
  // which is then not saved in the metadata.
  // Second request needs to recover by detecting the duplicate release.
  let req = fakeRequest({
    headers: { 'Content-Length': '2' },
    params: { version, rrev: '1', filename: 'one.txt' },
    body: Readable.from(['111']),
  })
  let res = fakeResponse()
  await expect(controllers.putRecipeRevisionFile(req, res)).rejects.toThrow()

  req = fakeRequest({
    headers: { 'Content-Length': '3' },
    params: { version, rrev: '1', filename: 'two.txt' },
    body: Readable.from(['222']),
  })
  res = fakeResponse()
  await controllers.putRecipeRevisionFile(req, res)
  expect(res.status).toBeCalledWith(201)
  expect(res.send).toBeCalledWith()

  req = fakeRequest({
    headers: { 'Content-Length': '3' },
    params: { version, rrev: '1', filename: 'three.txt' },
    body: Readable.from(['333']),
  })
  res = fakeResponse()
  await controllers.putRecipeRevisionFile(req, res)
  expect(res.status).toBeCalledWith(201)
  expect(res.send).toBeCalledWith()

}, 20000)
