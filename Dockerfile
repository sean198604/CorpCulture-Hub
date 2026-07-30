# ============================================================
# Dockerfile — CorpCulture-Hub 前端 + 图片上传后端
# ============================================================
# 基础镜像：官方 nginx:alpine（轻量级，约 7MB）
# 额外安装 nodejs 用于活动图片上传后端（零依赖）
# ============================================================

FROM nginx:alpine

# ----- 安装 Node.js（图片上传后端，零依赖） -----
RUN apk add --no-cache nodejs

# ----- 安装 ImageMagick（后台上传转 WebP 压缩用，系统二进制，非 Node 依赖） -----
RUN apk add --no-cache imagemagick

# ----- 拷贝静态资源 -----
# 将本地 dist 目录的内容拷贝到 nginx 默认静态文件目录
# 注意：使用 dist/ 而非 dist，确保内容直接放在 html/ 下
COPY dist/ /usr/share/nginx/html/

# ----- 覆盖 nginx 默认配置 -----
COPY nginx.conf /etc/nginx/conf.d/default.conf

# ----- 拷贝图片上传后端 -----
COPY server/ /app/server/

# ----- 创建图片存储目录 -----
# 运行时建议挂载数据卷： -v corpculture-uploads:/data/uploads
RUN mkdir -p /data/uploads

# ----- 声明暴露端口 -----
# 容器内 nginx 监听 80 端口
# 运行时通过 -p 7009:80 映射到宿主机
EXPOSE 80

# ----- 健康检查（可选） -----
# 每 30 秒检查一次 nginx 是否正常响应
# 注意：使用 127.0.0.1 而非 localhost，避免 wget 优先走 IPv6 ::1 而失败
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD wget -q --spider http://127.0.0.1:80/ || exit 1

# ----- 启动：后台运行 Node 上传服务，前台运行 nginx -----
CMD sh -c "node /app/server/index.js & nginx -g 'daemon off;'"
