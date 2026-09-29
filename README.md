# 企业文化日历 · CorpCulture-Hub

> 📅 企业内部「企业文化日历」单页应用（SPA），容器化部署，配套轻量图片上传后端。

## 项目概述

企业内部文化日历展示系统，前端为 Vue 3 单页应用，通过 Nginx 静态托管；另含一个零依赖的 Node.js 图片上传后端，用于活动图片的上传与 WebP 压缩存储。整体以 Docker 容器化交付。

| 项 | 内容 |
|---|---|
| 项目名称 | CorpCulture-Hub（企业文化日历） |
| 访问端口 | `7009`（容器映射 `-p 7009:80`） |
| 技术栈 | Vue 3 (SPA) + Nginx + Node.js（图片上传后端）+ ImageMagick |
| 部署方式 | Docker / Docker Compose |
| 仓库地址 | https://github.com/sean198604/CorpCulture-Hub |

## 目录结构

```
CorpCulture-Hub/
├── Dockerfile              # 镜像构建：nginx:alpine + node + imagemagick
├── nginx.conf              # Nginx 配置（覆盖默认）
├── dist/                  # 前端构建产物（Vue SPA，构建后静态资源）
├── server/
│   └── index.js           # 图片上传后端（零依赖 Node.js）
├── download_assets.py     # 资源下载辅助脚本
├── scan_vue.py            # Vue 结构扫描辅助脚本
└── outputs/               # 验证截图等运行期产物（已 gitignore，不入库）
```

> 说明：本仓库存放的是前端构建产物 `dist/` 与运行所需配置/脚本。前端源码由内部平台生成，构建后注入 `dist/`。

## 部署

### Docker 直接运行

```bash
docker build -t corpculture-hub .
docker run -d --name corpculture-hub -p 7009:80 \
  -v corpculture-uploads:/data/uploads \
  corpculture-hub
```

访问：http://<服务器IP>:7009

### 数据卷

- 图片上传目录建议挂载数据卷 `/data/uploads`，避免容器重建后图片丢失。

## 说明

- `outputs/` 目录为验证/截图等运行期产物，已在 `.gitignore` 中排除，不纳入版本控制。
- 图片上传后端随容器启动（`node /app/server/index.js`），与 Nginx 并行运行。
