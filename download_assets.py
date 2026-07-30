#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CorpCulture-Hub 资源下载与路径净化脚本
=====================================
功能：
  1. 模拟浏览器请求，下载目标应用的 index.html
  2. 自动嗅探并下载所有 .js / .css / 图片等静态资源到 dist/assets/
  3. 递归解析 JS 中的动态 import() 与 CSS 中的 url() 引用，确保子资源不遗漏
  4. 清洗 index.html：移除 <base> 标签、将远程路径替换为本地相对路径
  5. 生成 mock-api.js 拦截后端 XHR（点赞/评论/计数器），避免 401 报错
"""

import os
import re
import sys
import json
import time
from urllib.parse import urljoin, urlparse, urldefrag

import requests
from bs4 import BeautifulSoup

# ============================================================
# 配置区
# ============================================================

# 目标页面 URL
TARGET_URL = "https://share.lzhu.cn/play/sVbboIgauWylhqBl?skipLoadingDelay=1&s_uid=5561"

# 源站基础 URL（用于拼接根路径资源）
BASE_ORIGIN = "https://share.lzhu.cn"

# <base href> 指向的应用资源路径前缀
# HTML 中 <base href="/app/sVbboIgauWylhqBl/zh-CN/" />
APP_BASE_PATH = "/app/sVbboIgauWylhqBl/zh-CN/"

# 本地输出根目录
DIST_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dist")

# 本地资源目录
ASSETS_DIR = os.path.join(DIST_DIR, "assets")

# 模拟浏览器请求头
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/125.0.0.0 Safari/537.36"
    ),
    "Accept": (
        "text/html,application/xhtml+xml,application/xml;q=0.9,"
        "image/avif,image/webp,image/apng,*/*;q=0.8"
    ),
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Referer": BASE_ORIGIN + "/",
}

# 已下载资源缓存（避免重复下载）
downloaded = {}

# 下载失败的资源列表
failed = []


# ============================================================
# 工具函数
# ============================================================

def ensure_dir(path):
    """确保目录存在"""
    os.makedirs(path, exist_ok=True)


def fetch(url, is_binary=False):
    """
    请求远程 URL 并返回内容
    is_binary=True 时返回 bytes，否则返回 text
    """
    try:
        resp = requests.get(url, headers=HEADERS, timeout=30, allow_redirects=True)
        if resp.status_code == 200:
            return resp.content if is_binary else resp.text
        else:
            print(f"  [WARN] {resp.status_code} - {url}")
            failed.append(url)
            return None
    except Exception as e:
        print(f"  [ERROR] {e} - {url}")
        failed.append(url)
        return None


def resolve_url(raw_url, html_base_url=None):
    """
    将 HTML 中的原始 URL 解析为完整远程 URL
    处理三种情况：
      - 绝对 URL (https://...)
      - 根路径 (/assets/...)
      - 相对路径 (./assets/... 或 assets/...)，需结合 <base href>
    """
    if not raw_url or raw_url.startswith(("data:", "javascript:", "blob:", "#")):
        return None

    # 去掉查询参数和锚点用于本地存储（但保留完整 URL 用于下载）
    if raw_url.startswith("http://") or raw_url.startswith("https://"):
        return raw_url

    # 根路径：/lz-share-shell.js
    if raw_url.startswith("/"):
        return BASE_ORIGIN + raw_url

    # 相对路径：需结合 base href
    if html_base_url:
        return urljoin(html_base_url, raw_url)

    return urljoin(TARGET_URL, raw_url)


def get_local_path(remote_url):
    """
    将远程 URL 映射为本地文件路径
    策略：
      - /app/sVbboIgauWylhqBl/zh-CN/assets/xxx → dist/assets/xxx
      - /app/sVbboIgauWylhqBl/zh-CN/favicon.png → dist/favicon.png
      - /lz-share-shell.js → dist/assets/lz-share-shell.js
      - /start-loading.gif → dist/start-loading.gif
      - 其他带查询参数的 → 去掉参数后按文件名存储
    """
    parsed = urlparse(remote_url)
    path = parsed.path  # 不含查询参数

    # 去掉 /app/sVbboIgauWylhqBl/zh-CN/ 前缀
    if APP_BASE_PATH in path:
        relative = path.split(APP_BASE_PATH, 1)[1]
    else:
        # 去掉开头的 /
        relative = path.lstrip("/")

    # 确定本地存储路径
    if relative.startswith("assets/"):
        filename = relative.split("assets/", 1)[1]
        local_path = os.path.join(ASSETS_DIR, filename)
    elif relative.startswith("assets"):
        filename = relative.split("assets", 1)[1].lstrip("/")
        local_path = os.path.join(ASSETS_DIR, filename)
    else:
        # 其他资源（favicon.png, start-loading.gif 等）放在 dist 根目录
        filename = os.path.basename(relative)
        if not filename:
            filename = "resource_" + str(len(downloaded))
        local_path = os.path.join(DIST_DIR, filename)

    return local_path


def get_local_ref(remote_url):
    """
    获取用于 HTML 引用的本地相对路径
    """
    local_path = get_local_path(remote_url)
    rel = os.path.relpath(local_path, DIST_DIR)
    # 统一为正斜杠（HTML 中使用）
    return "./" + rel.replace("\\", "/")


def download_resource(remote_url, is_binary=True):
    """
    下载单个资源到本地，返回本地相对引用路径
    幂等：已下载过的资源直接返回缓存
    """
    if remote_url in downloaded:
        return downloaded[remote_url]

    local_path = get_local_path(remote_url)
    local_ref = get_local_ref(remote_url)

    # 如果文件已存在且在缓存中，跳过
    if os.path.exists(local_path):
        print(f"  [SKIP] 已存在 - {os.path.basename(local_path)}")
        downloaded[remote_url] = local_ref
        return local_ref

    print(f"  [DOWN] {remote_url}")
    content = fetch(remote_url, is_binary=is_binary)
    if content is None:
        return None

    ensure_dir(os.path.dirname(local_path))
    if is_binary:
        with open(local_path, "wb") as f:
            f.write(content)
    else:
        with open(local_path, "w", encoding="utf-8") as f:
            f.write(content)

    downloaded[remote_url] = local_ref
    return local_ref


def scan_js_for_chunks(js_content, js_remote_url):
    """
    扫描 JS 文件内容，寻找动态 import() 引用的其他 chunk 文件
    Vite 打包的动态导入通常形如：
      import("./chunk-XXXX.js")
      import("/assets/chunk-XXXX.js")
    也可能有静态资源引用如：
      new URL("./assets/xxx.png", import.meta.url)
    """
    # 匹配 import("...") 中的路径
    import_pattern = re.compile(r'import\(["\']([^"\']+)["\']\)')
    # 匹配 new URL("...", import.meta.url)
    url_pattern = re.compile(r'new URL\(["\']([^"\']+)["\'],\s*import\.meta\.url\)')

    found = set()

    for match in import_pattern.finditer(js_content):
        path = match.group(1)
        if path.startswith(("http", "//", "data:", "blob:")):
            continue
        found.add(path)

    for match in url_pattern.finditer(js_content):
        path = match.group(1)
        if path.startswith(("http", "//", "data:", "blob:")):
            continue
        found.add(path)

    return found


def scan_css_for_assets(css_content, css_remote_url):
    """
    扫描 CSS 文件中的 url() 引用（字体、背景图等）
    """
    url_pattern = re.compile(r'url\(["\']?([^"\')]+)["\']?\)')
    found = set()

    for match in url_pattern.finditer(css_content):
        path = match.group(1)
        # 跳过 data URI、blob、SVG 片段标识符（url(#a) 等）
        if path.startswith(("data:", "blob:", "#")):
            continue
        found.add(path)

    return found


# ============================================================
# 主流程
# ============================================================

def main():
    print("=" * 60)
    print("CorpCulture-Hub 资源下载与路径净化脚本")
    print("=" * 60)

    ensure_dir(DIST_DIR)
    ensure_dir(ASSETS_DIR)

    # --------------------------------------------------
    # 步骤 1：下载 index.html
    # --------------------------------------------------
    print("\n[步骤 1] 下载 index.html ...")
    html_content = fetch(TARGET_URL, is_binary=False)
    if html_content is None:
        print("[FATAL] 无法下载主页 HTML，终止")
        sys.exit(1)
    print(f"  HTML 大小: {len(html_content)} 字符")

    # --------------------------------------------------
    # 步骤 2：解析 HTML，提取所有资源引用
    # --------------------------------------------------
    print("\n[步骤 2] 解析 HTML 资源引用 ...")
    soup = BeautifulSoup(html_content, "html.parser")

    # 提取 <base href> 用于解析相对路径
    base_tag = soup.find("base")
    base_href = base_tag.get("href", "") if base_tag else ""
    # base href 对应的完整 URL
    html_base_url = BASE_ORIGIN + APP_BASE_PATH
    print(f"  <base href>: {base_href}")
    print(f"  资源基础 URL: {html_base_url}")

    # 收集所有需要下载的资源 URL
    resources = []  # (remote_url, tag_type, attr_name)

    # <script src="...">
    for script in soup.find_all("script", src=True):
        raw = script.get("src")
        # 去掉查询参数用于路径解析，但保留完整 URL 下载
        remote = resolve_url(raw, html_base_url)
        if remote:
            resources.append((remote, "script", "src"))
            print(f"  [script] {raw} -> {remote}")

    # <link href="..."> (CSS, modulepreload, icon 等)
    # 跳过 canonical / og:url 等非资源链接
    skip_rels = {"canonical", "og:url"}
    for link in soup.find_all("link", href=True):
        rel = link.get("rel")
        rel_str = " ".join(rel) if isinstance(rel, list) else (rel or "")
        if "canonical" in rel_str:
            continue  # canonical 链接不是资源
        raw = link.get("href")
        remote = resolve_url(raw, html_base_url)
        if remote:
            resources.append((remote, "link", "href"))
            print(f"  [link] {raw} -> {remote}")

    # <img src="...">
    for img in soup.find_all("img", src=True):
        raw = img.get("src")
        remote = resolve_url(raw, html_base_url)
        if remote:
            resources.append((remote, "img", "src"))
            print(f"  [img] {raw} -> {remote}")

    # --------------------------------------------------
    # 步骤 3：下载所有静态资源
    # --------------------------------------------------
    print(f"\n[步骤 3] 下载 {len(resources)} 个静态资源 ...")

    # 先下载主 JS 和 CSS，然后递归扫描子资源
    js_files_to_scan = []  # (remote_url, local_path)
    css_files_to_scan = []

    for remote_url, tag_type, attr in resources:
        # 判断是否为文本资源
        is_text = remote_url.endswith(".js") or remote_url.endswith(".css")
        local_ref = download_resource(remote_url, is_binary=not is_text)

        if local_ref is None:
            continue

        local_path = os.path.join(DIST_DIR, local_ref.lstrip("./").replace("/", os.sep))

        if remote_url.endswith(".js"):
            js_files_to_scan.append((remote_url, local_path))
        elif remote_url.endswith(".css"):
            css_files_to_scan.append((remote_url, local_path))

    # --------------------------------------------------
    # 步骤 4：递归扫描 JS 中的动态 import 和 CSS 中的 url()
    # --------------------------------------------------
    print(f"\n[步骤 4] 递归扫描子资源引用 ...")

    # 扫描 JS 文件
    for remote_url, local_path in js_files_to_scan:
        if not os.path.exists(local_path):
            continue
        with open(local_path, "r", encoding="utf-8", errors="ignore") as f:
            js_content = f.read()

        chunks = scan_js_for_chunks(js_content, remote_url)
        for chunk_path in chunks:
            # 动态 import 路径是相对于该 JS 文件的
            chunk_remote = urljoin(remote_url, chunk_path)
            if chunk_remote in downloaded:
                continue
            print(f"  [JS chunk] {chunk_path} -> {chunk_remote}")
            local_ref = download_resource(chunk_remote, is_binary=True)
            # 下载的子 chunk 也需要扫描
            if local_ref:
                sub_local = os.path.join(DIST_DIR, local_ref.lstrip("./").replace("/", os.sep))
                if sub_local.endswith(".js"):
                    js_files_to_scan.append((chunk_remote, sub_local))

    # 扫描 CSS 文件
    for remote_url, local_path in css_files_to_scan:
        if not os.path.exists(local_path):
            continue
        with open(local_path, "r", encoding="utf-8", errors="ignore") as f:
            css_content = f.read()

        assets = scan_css_for_assets(css_content, remote_url)
        for asset_path in assets:
            asset_remote = urljoin(remote_url, asset_path)
            if asset_remote in downloaded:
                continue
            print(f"  [CSS asset] {asset_path} -> {asset_remote}")
            download_resource(asset_remote, is_binary=True)

    # --------------------------------------------------
    # 步骤 5：清洗 index.html —— 路径本地化
    # --------------------------------------------------
    print("\n[步骤 5] 清洗 index.html 路径 ...")

    # 重新解析 HTML（因为可能需要修改多处）
    soup = BeautifulSoup(html_content, "html.parser")

    # 5.1 移除 <base> 标签（本地不需要它，否则路径解析会出错）
    base_tag = soup.find("base")
    if base_tag:
        base_tag.decompose()
        print("  [OK] 移除 <base> 标签")

    # 5.2 替换 <script src="...">
    for script in soup.find_all("script", src=True):
        raw = script.get("src")
        remote = resolve_url(raw, html_base_url)
        if remote and remote in downloaded:
            local_ref = downloaded[remote]
            script["src"] = local_ref
            print(f"  [script] {raw} -> {local_ref}")

    # 5.3 替换 <link href="...">
    for link in soup.find_all("link", href=True):
        raw = link.get("href")
        remote = resolve_url(raw, html_base_url)
        if remote and remote in downloaded:
            local_ref = downloaded[remote]
            link["href"] = local_ref
            print(f"  [link] {raw} -> {local_ref}")

    # 5.4 替换 <img src="...">
    for img in soup.find_all("img", src=True):
        raw = img.get("src")
        remote = resolve_url(raw, html_base_url)
        if remote and remote in downloaded:
            local_ref = downloaded[remote]
            img["src"] = local_ref
            print(f"  [img] {raw} -> {local_ref}")

    # 5.5 移除 Eruda 调试脚本（仅 localhost 生效，本地容器无意义）
    for script in soup.find_all("script"):
        if script.string and "eruda" in (script.string or "").lower():
            script.decompose()
            print("  [OK] 移除 Eruda 调试脚本")

    # 5.6 注入 mock-api.js 脚本（拦截后端 XHR 请求）
    mock_script = soup.new_tag("script", src="./assets/mock-api.js")
    # 插入到 <head> 最后
    head = soup.find("head")
    if head:
        head.append(mock_script)
        print("  [OK] 注入 mock-api.js 拦截脚本")

    # 5.7 保存清洗后的 index.html
    html_output_path = os.path.join(DIST_DIR, "index.html")
    with open(html_output_path, "w", encoding="utf-8") as f:
        f.write(str(soup))
    print(f"  [OK] 保存清洗后的 index.html -> {html_output_path}")

    # --------------------------------------------------
    # 步骤 6：生成 mock-api.js（拦截后端请求，避免 401）
    # --------------------------------------------------
    print("\n[步骤 6] 生成 mock-api.js ...")
    mock_api_path = os.path.join(ASSETS_DIR, "mock-api.js")
    mock_api_code = generate_mock_api()
    with open(mock_api_path, "w", encoding="utf-8") as f:
        f.write(mock_api_code)
    print(f"  [OK] 保存 mock-api.js -> {mock_api_path}")

    # --------------------------------------------------
    # 汇总
    # --------------------------------------------------
    print("\n" + "=" * 60)
    print("下载完成汇总")
    print("=" * 60)
    print(f"  成功下载: {len(downloaded)} 个资源")
    if failed:
        print(f"  失败资源: {len(failed)} 个")
        for f_url in failed:
            print(f"    - {f_url}")
    else:
        print("  失败资源: 0 个")
    print(f"  输出目录: {DIST_DIR}")
    print(f"  资源目录: {ASSETS_DIR}")
    print("=" * 60)


def generate_mock_api():
    """
    生成 mock-api.js 代码
    拦截前端 XHR/fetch 请求，对点赞/评论/计数器等接口返回模拟数据
    避免脱离原平台时出现 401 报错
    """
    return """/**
 * mock-api.js — 后端接口拦截器
 * 在本地离线环境下拦截 likes / comments / counter 等 XHR 请求
 * 返回合理的模拟数据，避免 401 报错影响前端渲染
 */
(function () {
  'use strict';

  // ====== 模拟数据存储 ======
  var mockStore = {
    likes: 0,
    comments: [],
    counter: 0,
    user: { id: 'local-user', name: '本地用户', avatar: '' }
  };

  // ====== 拦截 XMLHttpRequest ======
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this._mockUrl = url;
    this._mockMethod = (method || 'GET').toUpperCase();
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    var self = this;
    var url = self._mockUrl || '';
    var method = self._mockMethod || 'GET';

    // 匹配后端 API 路径模式
    var mockResponse = getMockResponse(method, url, body);

    if (mockResponse !== null) {
      // 模拟异步响应
      setTimeout(function () {
        // 模拟成功的 HTTP 响应
        Object.defineProperty(self, 'readyState', { value: 4, writable: true });
        Object.defineProperty(self, 'status', { value: 200, writable: true });
        Object.defineProperty(self, 'statusText', { value: 'OK', writable: true });
        Object.defineProperty(self, 'responseText', { value: JSON.stringify(mockResponse), writable: true });
        Object.defineProperty(self, 'response', { value: JSON.stringify(mockResponse), writable: true });

        if (typeof self.onreadystatechange === 'function') {
          self.onreadystatechange();
        }
        if (typeof self.onload === 'function') {
          self.onload();
        }
        self.dispatchEvent(new Event('load'));
        self.dispatchEvent(new Event('loadend'));
      }, 50);
      return;
    }

    // 非后端接口的请求正常发送
    return origSend.apply(this, arguments);
  };

  // ====== 拦截 fetch ======
  var origFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var method = (init && init.method) || 'GET';
    var body = init && init.body;

    var mockResponse = getMockResponse(method.toUpperCase(), url, body);

    if (mockResponse !== null) {
      return Promise.resolve(new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }));
    }

    return origFetch.apply(this, arguments);
  };

  // ====== 模拟响应路由 ======
  function getMockResponse(method, url, body) {
    // 点赞接口
    if (/likes/i.test(url)) {
      if (method === 'POST') {
        mockStore.likes++;
      } else if (method === 'DELETE') {
        mockStore.likes = Math.max(0, mockStore.likes - 1);
      }
      return { code: 0, data: { likes: mockStore.likes, liked: method === 'POST' } };
    }

    // 评论接口
    if (/comments/i.test(url)) {
      if (method === 'GET') {
        return { code: 0, data: { list: mockStore.comments, total: mockStore.comments.length } };
      }
      if (method === 'POST') {
        var comment = { id: Date.now(), content: body, user: mockStore.user.name, time: new Date().toISOString() };
        mockStore.comments.unshift(comment);
        return { code: 0, data: comment };
      }
    }

    // 计数器接口
    if (/counter/i.test(url) || /view/i.test(url) || /visit/i.test(url)) {
      if (method === 'GET') {
        return { code: 0, data: { count: mockStore.counter } };
      }
      if (method === 'POST' || method === 'PUT') {
        mockStore.counter++;
        return { code: 0, data: { count: mockStore.counter } };
      }
    }

    // 用户信息接口
    if (/user/i.test(url) && /info|profile|me/i.test(url)) {
      return { code: 0, data: mockStore.user };
    }

    // 其他 API 请求（api.lzhu.cn 等）
    if (url.indexOf('api.lzhu.cn') > -1 || url.indexOf('/api/') > -1) {
      return { code: 0, data: {}, msg: 'mock' };
    }

    // 非后端请求，不拦截
    return null;
  }

  console.log('[MockAPI] 后端接口拦截器已加载');
})();
"""


if __name__ == "__main__":
    main()
