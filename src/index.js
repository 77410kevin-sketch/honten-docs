/**
 * reports.kevinhung.org Worker
 *
 * 處理 API 請求；其他 fallback 到靜態檔（ASSETS）。
 *
 * API:
 *   GET  /api/meta              → 回傳目前 meta.json
 *   GET  /api/list-files        → 列出 repo 中所有 .html
 *   POST /api/save-meta         → 寫回 meta.json + 重新 build
 *   POST /api/delete-file       → 刪除指定 HTML 檔
 *
 * 認證：Cloudflare Access 已在路由層擋過一道（CF-Access-* headers），
 *      Worker 內進一步檢查 header 存在性。
 */

const GH_REPO = "77410kevin-sketch/honten-docs";
const GH_BRANCH = "master";
const COMMIT_AUTHOR = { name: "reports admin", email: "77410kevin@gmail.com" };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ---- API 路由 ----
    if (url.pathname.startsWith("/api/")) {
      // Access 認證（信任 Cloudflare Access 的 header）
      const accessEmail = request.headers.get("CF-Access-Authenticated-User-Email");
      if (!accessEmail) {
        return json({ error: "Unauthorized: no Access JWT" }, 401);
      }

      try {
        if (url.pathname === "/api/meta" && request.method === "GET") {
          return await handleGetMeta(env);
        }
        if (url.pathname === "/api/list-files" && request.method === "GET") {
          return await handleListFiles(env);
        }
        if (url.pathname === "/api/save-meta" && request.method === "POST") {
          return await handleSaveMeta(request, env, accessEmail);
        }
        if (url.pathname === "/api/delete-file" && request.method === "POST") {
          return await handleDeleteFile(request, env, accessEmail);
        }
        return json({ error: "Not found" }, 404);
      } catch (e) {
        return json({ error: String(e), stack: e.stack }, 500);
      }
    }

    // ---- 其他全部走靜態檔 ----
    return env.ASSETS.fetch(request);
  },
};

// ============ Handlers ============

async function handleGetMeta(env) {
  const file = await githubGetFile(env, "meta.json");
  if (!file) return json({ error: "meta.json not found" }, 404);
  return json(JSON.parse(file.content));
}

async function handleListFiles(env) {
  const resp = await githubFetch(
    env,
    `https://api.github.com/repos/${GH_REPO}/contents/?ref=${GH_BRANCH}`
  );
  if (!resp.ok) {
    return json({ error: `GitHub list ${resp.status}` }, 500);
  }
  const items = await resp.json();
  const htmls = items
    .filter(
      (i) =>
        i.type === "file" &&
        i.name.endsWith(".html") &&
        i.name !== "index.html"
    )
    .map((i) => i.name.replace(/\.html$/i, ""))
    .sort();
  return json({ files: htmls });
}

async function handleSaveMeta(request, env, email) {
  const newMeta = await request.json();
  // 基本驗證
  if (!newMeta || !Array.isArray(newMeta.categories)) {
    return json({ error: "Invalid meta: missing categories array" }, 400);
  }

  const content = JSON.stringify(newMeta, null, 2) + "\n";
  const result = await githubPutFile(
    env,
    "meta.json",
    content,
    `Admin edit meta.json by ${email}`
  );
  if (!result.ok) {
    return json({ error: "GitHub PUT failed", details: result.error }, 500);
  }
  return json({
    success: true,
    message: "meta.json 已更新，30-60 秒內生效",
    commit: result.commit,
  });
}

async function handleDeleteFile(request, env, email) {
  const body = await request.json();
  const filename = body.filename; // e.g. "泰國視察行程規劃_20260519-23.html"
  if (!filename || !filename.endsWith(".html") || filename === "index.html") {
    return json({ error: "Invalid filename" }, 400);
  }
  const file = await githubGetFile(env, filename);
  if (!file) return json({ error: "File not found in repo" }, 404);

  const resp = await githubFetch(
    env,
    `https://api.github.com/repos/${GH_REPO}/contents/${encodeURIComponent(filename)}`,
    {
      method: "DELETE",
      body: JSON.stringify({
        message: `Admin delete ${filename} by ${email}`,
        sha: file.sha,
        branch: GH_BRANCH,
        author: COMMIT_AUTHOR,
        committer: COMMIT_AUTHOR,
      }),
    }
  );

  if (!resp.ok) {
    const errText = await resp.text();
    return json({ error: `GitHub DELETE ${resp.status}`, details: errText }, 500);
  }

  return json({ success: true, message: `已刪除 ${filename}` });
}

// ============ GitHub helpers ============

async function githubFetch(env, url, init = {}) {
  const headers = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "reports.kevinhung.org-admin",
    ...(init.headers || {}),
  };
  if (init.body) {
    headers["Content-Type"] = "application/json";
  }
  return fetch(url, { ...init, headers });
}

/** 取 GitHub 檔案，回傳 {sha, content (decoded utf-8)} 或 null。 */
async function githubGetFile(env, path) {
  const resp = await githubFetch(
    env,
    `https://api.github.com/repos/${GH_REPO}/contents/${encodeURIComponent(path)}?ref=${GH_BRANCH}`
  );
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`GitHub GET ${path} ${resp.status}`);
  const data = await resp.json();
  // GitHub 回傳 base64 with newlines
  const b64 = (data.content || "").replace(/\n/g, "");
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const content = new TextDecoder("utf-8").decode(bytes);
  return { sha: data.sha, content };
}

/** 寫入或更新 GitHub 檔案。 */
async function githubPutFile(env, path, content, message) {
  // 先抓 SHA（如果存在）
  const existing = await githubGetFile(env, path).catch(() => null);

  // utf-8 → base64
  const bytes = new TextEncoder().encode(content);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = btoa(bin);

  const body = {
    message,
    content: b64,
    branch: GH_BRANCH,
    author: COMMIT_AUTHOR,
    committer: COMMIT_AUTHOR,
  };
  if (existing) body.sha = existing.sha;

  const resp = await githubFetch(
    env,
    `https://api.github.com/repos/${GH_REPO}/contents/${encodeURIComponent(path)}`,
    { method: "PUT", body: JSON.stringify(body) }
  );

  if (!resp.ok) {
    const errText = await resp.text();
    return { ok: false, error: `${resp.status}: ${errText}` };
  }
  const data = await resp.json();
  return { ok: true, commit: data.commit?.sha };
}

// ============ utils ============

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
