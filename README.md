# Haunting Things

[![GitHub](https://img.shields.io/badge/GitHub-wang--kaopu%2Fhaunting--things-blue?logo=github)](https://github.com/wang-kaopu/haunting-things)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![npm](https://img.shields.io/npm/v/haunting-things?label=npm&color=green)](https://www.npmjs.com/package/haunting-things)
[![Node](https://img.shields.io/node/v/haunting-things?label=node)](https://www.npmjs.com/package/haunting-things)
[![npm version](https://img.shields.io/npm/v/haunting-things?label=npm&color=green)](https://www.npmjs.com/package/haunting-things)

Haunting Things 是一个多智能体会话管理的 Web 服务器应用。启动后会在本机提供浏览器访问入口，用户可以通过 Web 页面创建团队、管理智能体成员、发起对话，并在同一个服务中保存会话、附件和运行状态。

## 特性

- 提供基于浏览器的团队与智能体工作台。
- 支持会话消息、附件和团队数据的本地持久化。
- 内置管理员账号认证，首次启动可直接登录并进入系统。
- 可开启局域网与 Tailscale 远程访问。

## 使用 npm install 安装

```bash
npm install -g haunting-things
haunting-things
```

服务默认监听 `http://127.0.0.1:25808`。如需修改端口，可在启动时设置 `PORT`：

```bash
PORT=3000 haunting-things
```

## 使用 npx 运行

```bash
npx haunting-things
```

服务启动后，在浏览器中打开 `http://127.0.0.1:25808` 即可使用。
