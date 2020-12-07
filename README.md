# k8s-graceful-shutdown

![CI](https://github.com/NeuroCode-io/k8s-graceful-shutdown/workflows/CI/badge.svg?branch=master)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=NeuroCode-io_k8s-graceful-shutdown&metric=alert_status)](https://sonarcloud.io/dashboard?id=NeuroCode-io_k8s-graceful-shutdown)
[![Maintainability Rating](https://sonarcloud.io/api/project_badges/measure?project=NeuroCode-io_k8s-graceful-shutdown&metric=sqale_rating)](https://sonarcloud.io/dashboard?id=NeuroCode-io_k8s-graceful-shutdown)
[![Reliability Rating](https://sonarcloud.io/api/project_badges/measure?project=NeuroCode-io_k8s-graceful-shutdown&metric=reliability_rating)](https://sonarcloud.io/dashboard?id=NeuroCode-io_k8s-graceful-shutdown)
[![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=NeuroCode-io_k8s-graceful-shutdown&metric=security_rating)](https://sonarcloud.io/dashboard?id=NeuroCode-io_k8s-graceful-shutdown)
[![Vulnerabilities](https://sonarcloud.io/api/project_badges/measure?project=NeuroCode-io_k8s-graceful-shutdown&metric=vulnerabilities)](https://sonarcloud.io/dashboard?id=NeuroCode-io_k8s-graceful-shutdown)

该库提供了使用 `Kubernetes` 实现 `Graceful Shutdown`(优雅退出) Node.js App 的资源。

## 问题描述

在 kubernetes 中运行微服务时。我们需要处理 kubernetes 发出的终止信号。这样做的正确方法是：

1. 监听 `SIGINT`, `SIGTERM`
2. 收到信号后，将服务置于不健康模式（`/health` 路由应返回状态码 `4xx`，`5xx`）
3. 在关闭之前添加宽限期，以允许 kubernetes 将您的应用程序从负载均衡器中移除
4. 关闭服务器和所有打开的连接
5. 关闭

该库使上述过程变得容易。只需注册您的 graceful shutdown hook（优雅退出的钩子）并添加宽限期即可。

请注意，您的宽限期**必须**小于 kubernetes 中定义的宽限期！

## 使用 Express 框架的示例

例如，使用Express框架：

```ts
import { Response, Request } from 'express'
import express from 'express'
import { addGracefulShutdownHook, getHealthHandler, shutdown } from '@neurocode.io/k8s-graceful-shutdown'

const app = express()
app.disable('x-powered-by')
const port = process.env.PORT || 3000
const server = app.listen(port, () => console.log(`App is running on http://localhost:${port}`))

// 修补 NodeJS 服务器关闭功能，使其具有正确的关闭功能，因为您可能期望为您关闭 keep-alive connections(保持活动的连接)！
// 在这里阅读更多信息 https://github.com/nodejs/node/issues/2642
server.close = shutdown(server)

const healthy = (req: Request, res: Response) => {
  res.send('everything is great')
}

const notHealthy = (req: Request, res: Response) => {
  res.status(503).send('oh no, something bad happened!')
}


const healthTest = async () => {
  // 这是可选的
  // 你可以用它来进行健康检查
  return true
}

const healthCheck = getHealthHandler({ healthy, notHealthy, test: healthTest })
app.get('/health', healthCheck)

const sleep = (time: number) => new Promise((resolve) => setTimeout(resolve, time))

const asyncOperation = async () => sleep(3000).then(() => console.log('Async op done'))

const closeServers = async () => {
  await asyncOperation() // 可以是任何异步操作，例如 mongo db 关闭，或发送 slack 消息;）
  server.close()
}

const gracePeriodSec = 5*1000
addGracefulShutdownHook(gracePeriodSec, closeServers)

server.addListener('close', () => console.log('shutdown after graceful period'))
```

* 上面所示的这个简单的应用程序，添加了一个`5`秒的优雅关闭周期，在此之后，钩子(在关闭功能的帮助下负责关闭服务器)被触发。在发送 `SIGINT` 或 `SIGTERM` 信号时，用户可以看到`5`秒的宽限期，之后发生了`3`秒的等待异步操作，然后才会显示 `“shutdown after graceful period”` 的消息，表示关闭服务器。

* 该应用程序还展示了 `“getHealthHandler”` 的功能。在请求 `localhost:3000/health` 时，`healthTest` 将返回 `true`，并显示 `'everything is great'` 消息，表明 health 检查为正常。用户可以将 `healthTest` 改为返回 `false`，然后看到消息变为 `'oh no, something bad happened!'` 这表明了一种不健康的状态。

如果您使用 `Koa` 框架，请查看 `**demos/**` 文件夹。 我们有一个 `Koa` 示例，其功能与上述应用类似。`Koa` 应用程序使用具有 `health`和 `notHealthy` 处理程序的 `fn(ctx)` 支持的 `getHealthContextHandler`，而不是将 `health` 和 `notHealthy` 处理程序作为 `fn(req, res)` 的 `getHealthHandler`。

## 它是如何工作的？

正常关闭工作流程的工作方式示例：

1. `Kubernetes` 向 `Pod` 发送 `SIGTERM` 信号。手动缩小 `Pod` 或在滚动部署期间自动缩小 `Pod` 时会发生这种情况
2. 该库接收 `SIGTERM` 信号并调用您的 `notHealthy` 处理程序。您的处理程序应返回 `400` 或 `500` 的 `http` 状态代码（抛出错误？），这表明该 `pod` 不再接收任何流量。注意此步骤是可选的（请检查下一步）
3. 库等待指定的 **grace time** 以启动应用程序的关闭。宽限时间应在 `5` 到 `20` 秒之间。 `kubernetes` 端点控制器需要宽限时间才能从有效端点列表中删除 `Pod`，进而从服务中删除 `Pod`（从 `iptables` 所有节点中获取 `pod` 的 `ip` 地址）。
4. `Kubernetes` 从 `Service` 中删除 `Pod`
5. 该库调用您所有已注册的关闭 hook
6. 在配置的宽限期之后，应用程序将使用我们的关机机制正确地关机，你可能[期望默认工作](https://github.com/nodejs/node/issues/2642)，但在 `NodeJS http server`, `express` 和 `Koa` 不是
   
