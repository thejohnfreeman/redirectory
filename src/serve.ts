import express from 'express'
import router from './router'

const port = process.env.PORT || 9595

const app = express()

app.set('trust proxy', true)

app.use(router)

app.listen(port, () => {
  console.log(`listening on port ${port}`)
})
