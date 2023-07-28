import express from 'express'
import serverless from 'serverless-http'
import router from '../../router.js'

const app = express()
app.use('/.netlify/functions/api/', router)
export const handler = serverless(app)
