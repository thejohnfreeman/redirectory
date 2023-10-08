import 'expect-more-jest'
import { readFileSync } from 'fs'
import { Readable } from 'stream'
import { Octokit } from 'octokit'
import * as controllers from '../src/controllers.js'

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

const fakeResponse = () => ({ send: jest.fn(), redirect: jest.fn() })

test('octokit', async () => {
  const r = await kit.rest.repos.getReleaseByTag({ owner, repo, tag })
  expect(r.status).toBe(200)
})

test('GET /:recipe', async () => {
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

test('GET /:recipe/latest', async () => {
  const req = fakeRequest()
  const res = fakeResponse()
  await controllers.getRecipeLatest(req, res)
  expect(res.send).toBeCalledWith(expectRevision)
})

test('GET /:recipe/revisions', async () => {
  const req = fakeRequest()
  const res = fakeResponse()
  await controllers.getRecipeRevisions(req, res)
  expect(res.send).toBeCalledWith(expect.toBeArrayOf(expectRevision))
})

test('GET /:rrev/files', async () => {
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

test('GET /:rrev/file/:filename', async () => {
  const req = fakeRequest({ params: { rrev: '0', filename: 'conanmanifest.txt' } })
  const res = fakeResponse()
  await controllers.getRecipeRevisionFile(req, res)
  expect(res.redirect).toBeCalledWith(
    301, expect.stringMatching(/^https:\/\/github.com\//),
  )
})

test.only('PUT /:rrev/file/:filename', async () => {
  const req = fakeRequest({
    params: { version: '0.1.2', rrev: '1', filename: 'one.txt' },
    body: Readable.from(['111'])
  })
  const res = fakeResponse()
  try {
    await controllers.putRecipeRevisionFile(req, res)
  }
})
