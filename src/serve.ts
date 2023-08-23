import express from 'express'
import router from './router.js'
import winston from 'winston'
import expressWinston from 'express-winston'

const port = process.env.PORT || 9595
const verbosity = parseInt(process.env.VERBOSITY) || 0

const app = express()

if (verbosity > 0) {
  expressWinston.requestWhitelist.push('body')
  expressWinston.responseWhitelist.push('headers', 'body')
  app.use(expressWinston.logger({
    transports: [
      new winston.transports.Console()
    ],
    format: winston.format.combine(
      winston.format.prettyPrint(),
    ),
  }))
}

app.use(router)
app.listen(port, () => {
  console.log(`listening on port ${port}`)
})
