import express from 'express'
import router from './router.js'

const port = 9494
const app = express()
app.use(router)
app.listen(port, () => {
  console.log(`listening on port ${port}`)
})
