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
- 工作区作为独立实体保存，会话和团队只通过 `workspaceId` 关联；WebUI 只能在服务端启动项目目录内新建工作区分组，不支持手工输入绝对路径。
- 左侧 Teams 按工作区分组展示，未绑定持久工作区的内容统一归入“对话”；工作区不能被直接删除，当其下没有 Team 和 Conversation 时会自动清理工作区记录，且不会删除磁盘上的实际文件夹。
- 支持 ACP session、权限模式、模型选择和 MCP 工具配置的会话级恢复。
- ACP session 无法恢复时，会用本地历史消息为新 session 注入兜底上下文。
- 应用重启会自动修复异常退出遗留的 running 会话状态。
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
