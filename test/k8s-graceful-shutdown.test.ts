import assert from 'assert'
import { addGracefulShutdownHook, removeGracefulShutdownHook, getHealthzHandler } from '../lib/k8s-graceful-shutdown'
import { setTimeout } from 'timers'
import { IncomingMessage, ServerResponse } from 'http'
import { Socket } from 'net'

const signals = ['SIGINT', 'SIGTERM', 'SIGUSR2'] as const
let callbackCalled: boolean
let health: string
let healthzCheck: (req: IncomingMessage, res: ServerResponse) => void

const testCallback = () => {
  callbackCalled = true
}

const healthyCB = () => {
  health = 'OK'
}

const notHealthyCB = () => {
  health = 'not OK'
}

const req = new IncomingMessage(new Socket())
const res = new ServerResponse(req)

describe('get healthz handler', () => {
  it('get healthz handler should return correct health check', () => {
    healthzCheck = getHealthzHandler({ healthy: healthyCB, notHealthy: notHealthyCB })
    healthzCheck(req, res)
    assert.equal(health, 'OK')

    healthzCheck = getHealthzHandler({
      healthy: healthyCB,
      notHealthy: notHealthyCB,
      test: () => {
        return true
      },
    })
    healthzCheck(req, res)
    assert.equal(health, 'OK')

    healthzCheck = getHealthzHandler({
      healthy: healthyCB,
      notHealthy: notHealthyCB,
      test: () => {
        return false
      },
    })
    healthzCheck(req, res)
    assert.equal(health, 'not OK')
  })
})

describe('exit signals test', async () => {
  process.once('beforeExit', () => {
    process.stdin.resume()
  })

  before(() => {
    addGracefulShutdownHook(0, testCallback)
    callbackCalled = false
    health = 'test'
  })

  afterEach(() => {
    callbackCalled = false
    health = 'test'
  })

  signals.forEach(signal => {
    it(`it should add graceful shutdown hook on exit signal: ${signal}`, done => {
      healthzCheck = getHealthzHandler({
        healthy: healthyCB,
        notHealthy: notHealthyCB,
        test: () => {
          return true
        },
      })
      healthzCheck(req, res)
      assert.equal(health, 'OK')

      process.once(signal, () => {
        setTimeout(() => {
          assert.equal(callbackCalled, true)
          healthzCheck(req, res)
          assert.equal(health, 'not OK')
          done()
        }, 100)
      })

      process.kill(process.pid, signal)
    })
  })
})

describe('remove graceful shutdown hooks', () => {
  before(() => {
    removeGracefulShutdownHook(testCallback)
  })

  signals.forEach(signal => {
    it(`it should remove graceful shutdown hook on exit signal: ${signal}`, done => {
      process.once(signal, () => {
        setTimeout(() => {
          assert.equal(callbackCalled, false)
          done()
        }, 100)
      })

      process.kill(process.pid, signal)
    })
  })
})